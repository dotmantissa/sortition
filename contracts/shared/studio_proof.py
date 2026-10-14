# Embedded into the single-file contracts by scripts/sync-contract-proof.py.
# Studio receipts are consensus-checked oracle observations from this immutable
# network RPC, not cryptographic inclusion proofs or a production bridge.
PROOF_RPC = 'https://studio.genlayer.com/api'
PROOF_CHAIN_ID = 61999


def proof_hash(value: str) -> bool:
    return isinstance(value, str) and len(value) == 66 and value.startswith('0x') and all(c in '0123456789abcdefABCDEF' for c in value[2:])


def rpc_transaction(tx_hash: str) -> dict:
    if not proof_hash(tx_hash):
        raise gl.vm.UserError('A valid transaction hash is required')
    try:
        response = gl.nondet.web.post(PROOF_RPC, body=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'eth_getTransactionByHash', 'params': [tx_hash]}), headers={'Content-Type': 'application/json'})
        if response.status != 200:
            raise ValueError('RPC unavailable')
        result = json.loads(response.body.decode('utf-8')).get('result')
    except Exception:
        raise gl.vm.UserError('[TRANSIENT] Finalized receipt unavailable')
    if not isinstance(result, dict) or str(result.get('hash', '')).lower() != tx_hash.lower():
        raise gl.vm.UserError('[TRANSIENT] Receipt not found')
    if result.get('status') not in (7, 'FINALIZED'):
        raise gl.vm.UserError('[TRANSIENT] Receipt is not finalized')
    return result


def receipt_leader(receipt: dict) -> dict:
    leaders = receipt.get('consensus_data', {}).get('leader_receipt', [])
    if isinstance(leaders, dict):
        leaders = [leaders]
    leaders = [l for l in leaders if l.get('mode') == 'leader']
    if not leaders:
        raise gl.vm.UserError('Receipt has no executing leader')
    return leaders[-1]


def receipt_marker(receipt: dict, key: str) -> dict:
    leader = receipt_leader(receipt)
    if leader.get('execution_result') != 'SUCCESS':
        raise gl.vm.UserError('Parent execution did not succeed')
    markers = []
    for line in leader.get('genvm_result', {}).get('stdout', '').splitlines():
        try:
            parsed = json.loads(line)
            if isinstance(parsed, dict) and isinstance(parsed.get(key), dict):
                markers.append(parsed[key])
        except Exception:
            pass
    if len(markers) != 1:
        raise gl.vm.UserError('Receipt is not bound to this operation')
    return markers[0]


def receipt_panel(receipt: dict, required: int) -> dict:
    leader = receipt_leader(receipt)
    members = [leader] + receipt.get('consensus_data', {}).get('validators', [])
    addresses = set()
    agreeing = set()
    independent = set()
    leader_address = str(leader.get('node_config', {}).get('address', '')).lower()
    for member in members:
        address = str(member.get('node_config', {}).get('address', '')).lower()
        if len(address) != 42 or not address.startswith('0x') or member.get('execution_result') != 'SUCCESS' or member.get('vote') not in ('agree', 'disagree'):
            continue
        addresses.add(address)
        if member.get('vote') == 'agree':
            agreeing.add(address)
        if address != leader_address and member.get('mode') == 'validator':
            independent.add(address)
    observed = len(addresses)
    verified = observed >= required and len(independent) > 0 and len(agreeing) > observed // 2
    return {'required': required, 'observed': observed, 'independent_validators': len(independent), 'agreeing': len(agreeing), 'verified': verified}
