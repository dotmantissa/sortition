# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json
from datetime import datetime

# BEGIN STUDIO RECEIPT PROOF
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
# END STUDIO RECEIPT PROOF


MINIMUM_PANEL = 5
PANEL_STEP = 2


@gl.evm.contract_interface
class NativeRecipient:
    class View:
        pass

    class Write:
        pass


def now() -> int:
    return int(datetime.fromisoformat(gl.message_raw['datetime'].replace('Z', '+00:00')).timestamp())


def panel_for(challenge_count: int) -> int:
    # The required panel for a round is fixed on chain when its funding is
    # authorized, so any reader can check an actual receipt against it.
    return MINIMUM_PANEL + PANEL_STEP * challenge_count


class SettlementVault(gl.Contract):
    owner: Address
    treasury: Address
    registry: Address
    configured: bool
    accounts: TreeMap[str, str]
    credits: TreeMap[Address, u256]
    payments: TreeMap[Address, str]
    payment_sequence: u256

    def __init__(self, treasury: str):
        self.owner = gl.message.sender_address
        self.treasury = Address(treasury)
        self.configured = False

    @gl.public.write
    def configure(self, registry: str) -> None:
        if gl.message.sender_address != self.owner or self.configured:
            raise gl.vm.UserError('Registry can be configured once by owner')
        self.registry = Address(registry)
        self.configured = True

    @gl.public.view
    def get_configuration(self) -> dict:
        return {'version': 5, 'relay': str(self.owner), 'treasury': str(self.treasury), 'registry': str(self.registry) if self.configured else '', 'configured': self.configured, 'minimum_panel': MINIMUM_PANEL, 'panel_step': PANEL_STEP}

    @gl.public.write
    def transfer_relay(self, relay: str) -> None:
        # A lost or retired relay key must not freeze sponsorship and payment
        # reconciliation. Verdicts are never chosen here, so handing over the
        # relay cannot change any stored outcome.
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError('Only the current relay can hand over its role')
        self.owner = Address(relay)

    @gl.public.write
    def bind(self, question_id: str, docket: str, beneficiary: str, fee: int, base_bond: int, appeal_window: int, criteria_hash: str, close_timestamp: int, hearing_timeout: int, max_rounds: int) -> None:
        if not self.configured or gl.message.sender_address != self.registry:
            raise gl.vm.UserError('Only registry can bind a docket')
        if question_id in self.accounts or fee < 0 or base_bond <= 0 or not 60 <= appeal_window <= 604800:
            raise gl.vm.UserError('Invalid escrow terms')
        if close_timestamp <= 0 or not 300 <= hearing_timeout <= 2592000 or not 1 <= max_rounds <= 8:
            raise gl.vm.UserError('Invalid hearing deadline terms')
        account = {'version': 5, 'docket': str(Address(docket)), 'beneficiary': str(Address(beneficiary)), 'fee': str(fee), 'base_bond': str(base_bond), 'funded': fee == 0, 'settled': False, 'refunded': False, 'challenge_count': 0, 'opened_round': 0, 'round_deadline': 0, 'appeal_window': appeal_window, 'criteria_hash': criteria_hash, 'ruling_round': 0, 'ruling_outcome': 'PENDING', 'challenges': [], 'outcome': 'PENDING', 'fee_payer': '', 'close_timestamp': close_timestamp, 'hearing_timeout': hearing_timeout, 'max_rounds': max_rounds, 'hearing_deadline': 0, 'required_validators': panel_for(0)}
        if fee == 0:
            # Every funded hearing carries a deadline from the moment it becomes
            # payable, so locked value always has a bounded exit.
            account['hearing_deadline'] = max(now(), close_timestamp) + hearing_timeout
        self.accounts[question_id] = json.dumps(account)
        if fee == 0:
            gl.get_contract_at(Address(docket)).emit(on='finalized').prepare_round(0, panel_for(0))

    @gl.public.view
    def get_account(self, question_id: str) -> dict:
        if question_id not in self.accounts:
            raise gl.vm.UserError('Escrow not found')
        return json.loads(self.accounts[question_id])

    @gl.public.write.payable
    def fund(self, question_id: str) -> None:
        a = self.get_account(question_id)
        if a['settled'] or a['funded'] or int(gl.message.value) != int(a['fee']):
            raise gl.vm.UserError('Send the exact unfunded resolution fee')
        a['funded'] = True
        a['fee_payer'] = str(gl.message.sender_address)
        a['hearing_deadline'] = max(now(), int(a['close_timestamp'])) + int(a['hearing_timeout'])
        self.accounts[question_id] = json.dumps(a)
        gl.get_contract_at(Address(a['docket'])).emit(on='finalized').prepare_round(0, panel_for(0))

    @gl.public.write
    def prepare_hearing(self, question_id: str) -> None:
        # Replay finalized funding after a failed asynchronous delivery. This
        # never transfers value or changes the escrow or its challenge count.
        a = self.get_account(question_id)
        if not a['funded'] or a['settled']:
            raise gl.vm.UserError('An unsettled funded hearing is required')
        gl.get_contract_at(Address(a['docket'])).emit(on='finalized').prepare_round(a['challenge_count'], panel_for(a['challenge_count']))

    @gl.public.write
    def record_ruling(self, question_id: str, outcome: str, round_number: int, criteria_hash: str, hearing_tx: str, observed: int, independent: int) -> None:
        a = self.get_account(question_id)
        if gl.message.sender_address != Address(a['docket']) or criteria_hash != a['criteria_hash']:
            raise gl.vm.UserError('Only the registered docket can publish its finalized ruling')
        if not proof_hash(hearing_tx) or observed < int(a['required_validators']) or independent < 1:
            raise gl.vm.UserError('A verified required jury is mandatory')
        if outcome not in ('YES', 'NO', 'UNRESOLVABLE'):
            raise gl.vm.UserError('Invalid outcome')
        # A refunded hearing is closed. Accept a late in flight ruling quietly
        # so the preserved docket record never fails an emitted message.
        if a['refunded']:
            return
        if round_number == a['ruling_round'] and outcome == a['ruling_outcome']:
            return
        if a['settled'] or not a['funded'] or round_number != a['challenge_count'] + 1 or round_number <= a['ruling_round']:
            raise gl.vm.UserError('A new funded ruling is required')
        timestamp = now()
        a.update(hearing_tx=hearing_tx, panel_verified=True, observed_validators=observed, independent_validators=independent, ruling_round=round_number, ruling_outcome=outcome, opened_round=round_number, round_deadline=timestamp + a['appeal_window'], hearing_deadline=0)
        self.accounts[question_id] = json.dumps(a)

    @gl.public.write.payable
    def challenge(self, question_id: str, claimant: str, expected_outcome: str) -> None:
        if gl.message.sender_address not in (self.owner, Address(claimant)):
            raise gl.vm.UserError('Only claimant or operator relay can fund a challenge')
        a = self.get_account(question_id)
        state = {'round': a['ruling_round'], 'outcome': a['ruling_outcome']}
        timestamp = now()
        required = int(a['base_bond']) * 2 ** a['challenge_count']
        if a['settled'] or not a['funded'] or state['round'] != a['challenge_count'] + 1 or a['opened_round'] != state['round'] or timestamp >= a['round_deadline']:
            raise gl.vm.UserError('No round is open for challenge')
        if expected_outcome not in ('YES', 'NO', 'UNRESOLVABLE') or expected_outcome == state['outcome']:
            raise gl.vm.UserError('Challenge must name a different outcome')
        if int(gl.message.value) != required:
            raise gl.vm.UserError('Send the exact escalating bond')
        # Bounded rounds keep the escalating panel inside the range this
        # deployment can actually seat and prevent settlement loops.
        if a['challenge_count'] >= int(a['max_rounds']):
            raise gl.vm.UserError('Maximum bonded rounds reached for this docket')
        a['challenges'].append({'claimant': str(Address(claimant)), 'payer': str(gl.message.sender_address), 'expected': expected_outcome, 'bond': str(required), 'round': state['round']})
        a['challenge_count'] += 1
        a['hearing_deadline'] = timestamp + int(a['hearing_timeout'])
        a['required_validators'] = panel_for(a['challenge_count'])
        self.accounts[question_id] = json.dumps(a)
        gl.get_contract_at(Address(a['docket'])).emit(on='finalized').prepare_round(a['challenge_count'], panel_for(a['challenge_count']))

    @gl.public.write
    def finalize(self, question_id: str) -> None:
        a = self.get_account(question_id)
        state = {'round': a['ruling_round'], 'outcome': a['ruling_outcome']}
        timestamp = now()
        if a['settled'] or not a['funded'] or state['round'] != a['challenge_count'] + 1 or a['opened_round'] != state['round'] or timestamp < a['round_deadline']:
            raise gl.vm.UserError('A completed round and expired appeal window are required')
        winners = [c for c in a['challenges'] if c['expected'] == state['outcome']]
        pool = sum(int(c['bond']) for c in a['challenges'])
        # Return winning bonds and divide losing bonds by winning bonded stake.
        winning_stake = sum(int(c['bond']) for c in winners)
        allocated = 0
        for c in winners:
            share = pool * int(c['bond']) // winning_stake
            allocated += share
            addr = Address(c['payer'])
            self.credits[addr] = self.credits.get(addr, u256(0)) + u256(share)
        # Sponsored principal and rewards belong to the economic payer.
        # No winner means forfeiture to the treasury, never a free operator
        # profit. The deployed treasury is outside the relay's control.
        self.credits[self.treasury] = self.credits.get(self.treasury, u256(0)) + u256(pool - allocated)
        self.credits[self.treasury] = self.credits.get(self.treasury, u256(0)) + u256(int(a['fee']))
        a.update(settled=True, outcome=state['outcome'], final_round=state['round'], hearing_deadline=0)
        self.accounts[question_id] = json.dumps(a)
        gl.get_contract_at(Address(a['docket'])).emit(on='finalized').close_settlement()

    @gl.public.write
    def claim_timeout(self, question_id: str) -> None:
        # Permissionless bounded exit. When a funded hearing produces no ruling
        # before its deadline, every bond returns to the account that actually
        # paid it and the resolution fee returns to its funder. No relay, no
        # operator and no further consensus is required.
        a = self.get_account(question_id)
        if a['settled'] or not a['funded']:
            raise gl.vm.UserError('An unsettled funded hearing is required')
        deadline = int(a['hearing_deadline'])
        if deadline <= 0 or a['ruling_round'] == a['challenge_count'] + 1:
            raise gl.vm.UserError('This round already produced a ruling; finalize it instead')
        if now() < deadline:
            raise gl.vm.UserError('The funded hearing deadline has not passed')
        for c in a['challenges']:
            addr = Address(c['payer'])
            self.credits[addr] = self.credits.get(addr, u256(0)) + u256(int(c['bond']))
        if a['fee_payer']:
            payer = Address(a['fee_payer'])
            self.credits[payer] = self.credits.get(payer, u256(0)) + u256(int(a['fee']))
        a.update(settled=True, refunded=True, outcome='REFUNDED', final_round=a['ruling_round'], hearing_deadline=0)
        self.accounts[question_id] = json.dumps(a)
        gl.get_contract_at(Address(a['docket'])).emit(on='finalized').close_settlement()

    @gl.public.write
    def withdraw(self, beneficiary: str) -> None:
        addr = Address(beneficiary)
        if gl.message.sender_address not in (addr, self.owner):
            raise gl.vm.UserError('Only beneficiary or relay can withdraw')
        amount = self.credits.get(addr, u256(0))
        if amount == 0:
            raise gl.vm.UserError('No credit to withdraw')
        prior = json.loads(self.payments.get(addr, '{}'))
        if prior.get('status') == 'pending':
            raise gl.vm.UserError('A payment is awaiting delivery confirmation')
        self.payment_sequence += u256(1)
        self.payments[addr] = json.dumps({'id': str(self.payment_sequence), 'amount': str(amount), 'status': 'pending', 'opened_at': now()})
        self.credits[addr] = u256(0)
        # An EOA has no GenVM code. Empty EVM calldata emits a native transfer.
        NativeRecipient(addr).emit_transfer(value=amount)
        print(json.dumps({'sortition_payment': {'id': str(self.payment_sequence), 'beneficiary': str(addr), 'amount': str(amount)}}))

    @gl.public.view
    def get_credit(self, beneficiary: str) -> str:
        return str(self.credits.get(Address(beneficiary), u256(0)))

    @gl.public.view
    def get_payment(self, beneficiary: str) -> dict:
        return json.loads(self.payments.get(Address(beneficiary), '{}'))

    @gl.public.write
    def confirm_withdrawal(self, beneficiary: str, payment_id: str, withdrawal_tx: str) -> None:
        # The beneficiary can accept delivery of their own payment, so a quiet
        # relay cannot leave a delivered payment pending forever. Only the
        # recipient of the value can give this up.
        addr = Address(beneficiary)
        if gl.message.sender_address not in (self.owner, addr):
            raise gl.vm.UserError('Only the beneficiary or relay can confirm delivery')
        p = self.get_payment(beneficiary)
        if p.get('id') != payment_id or p.get('status') != 'pending':
            raise gl.vm.UserError('Payment is not pending')
        proof = self.payment_proof(beneficiary, p, withdrawal_tx)
        if not proof['delivered']:
            raise gl.vm.UserError('Native transfer did not execute successfully')
        p.update(withdrawal_tx=withdrawal_tx, transfer_tx=proof['transfer_tx'])
        p['status'] = 'delivered'
        p['confirmed_by'] = str(gl.message.sender_address)
        self.payments[addr] = json.dumps(p)

    @gl.public.write.payable
    def restore_withdrawal(self, beneficiary: str, payment_id: str, withdrawal_tx: str) -> None:
        # A failed external payment does not return its value automatically, so
        # restored credit must arrive with exact native backing. Any account may
        # supply it, including the beneficiary, so recovery never waits for the
        # relay to be available or funded.
        addr = Address(beneficiary)
        p = self.get_payment(beneficiary)
        if p.get('id') != payment_id or p.get('status') != 'pending':
            raise gl.vm.UserError('Payment is not pending')
        proof = self.payment_proof(beneficiary, p, withdrawal_tx)
        if proof['delivered']:
            raise gl.vm.UserError('A delivered payment cannot be restored')
        p.update(withdrawal_tx=withdrawal_tx, transfer_tx=proof['transfer_tx'])
        amount = int(p['amount'])
        if int(gl.message.value) != amount:
            raise gl.vm.UserError('Restoration requires exact native backing')
        self.credits[addr] = self.credits.get(addr, u256(0)) + u256(amount)
        p['status'] = 'restored'
        p['restored_by'] = str(gl.message.sender_address)
        self.payments[addr] = json.dumps(p)

    def payment_proof(self, beneficiary: str, payment: dict, withdrawal_tx: str) -> dict:
        address = str(gl.message.contract_address).lower()
        expected = {'id': payment['id'], 'beneficiary': str(Address(beneficiary)), 'amount': payment['amount']}
        def verify():
            parent = rpc_transaction(withdrawal_tx)
            if str(parent.get('to_address', '')).lower() != address or receipt_marker(parent, 'sortition_payment') != expected:
                raise gl.vm.UserError('Withdrawal receipt does not match this payment')
            children = parent.get('triggered_transactions', [])
            if not isinstance(children, list) or len(children) != 1:
                raise gl.vm.UserError('[TRANSIENT] Exactly one finalized native transfer is required')
            child = rpc_transaction(children[0])
            if str(child.get('from_address', '')).lower() != address or str(child.get('to_address', '')).lower() != beneficiary.lower() or int(child.get('value', -1)) != int(payment['amount']) or child.get('type') not in (0, '0x0', 'SEND') or str(child.get('triggered_by', '')).lower() != withdrawal_tx.lower():
                raise gl.vm.UserError('Native transfer is not bound to this payment')
            # Studio records the actual ledger effect, not just parent success.
            credited = child.get('value_credited')
            if type(credited) is not bool:
                raise gl.vm.UserError('[TRANSIENT] Transfer execution proof is missing')
            return {'transfer_tx': children[0], 'delivered': credited}
        return dict(gl.eq_principle.strict_eq(verify))
