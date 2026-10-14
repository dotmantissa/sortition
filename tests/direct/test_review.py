"""Reviewer regressions exercise raw proposals and independently fetched receipts."""
import json
import sys
import hashlib
from types import SimpleNamespace
import pytest
from conftest import address, warp, mock_hearing, hearing_receipt, deploy_docket, vault_stub, BODY, QUOTE

PARENT = '0x'+'2'*64
CHILD = '0x'+'3'*64
HEARING = '0x'+'1'*64


def serve_rpc(monkeypatch, receipts):
    from genlayer import gl
    def post(url, *, body, headers):
        assert url == 'https://studio.genlayer.com/api'
        request = json.loads(body)
        assert request['method'] == 'eth_getTransactionByHash'
        result = receipts.get(request['params'][0])
        return SimpleNamespace(status=200, body=json.dumps({'result': result}).encode())
    monkeypatch.setattr(gl.nondet.web, 'post', post)


def raw_candidate(docket, vm):
    mock_hearing(vm)
    docket.propose()
    d = docket.get_docket()
    candidate = d['candidates'][-1]
    candidate['criteria_hash'] = d['criteria_hash']
    from genlayer import gl
    return candidate, str(gl.message.contract_address)


@pytest.mark.parametrize('size', [1, 3, 4])
def test_direct_undersized_jury_never_publishes_a_ruling(docket, direct_vm, direct_bob, monkeypatch, size):
    # Clock is well beyond relay grace; the sender is a direct non-relay account.
    direct_vm.sender = direct_bob
    published = []
    vault_stub(monkeypatch, published)
    candidate, target = raw_candidate(docket, direct_vm)
    assert docket.get_settlement()['outcome'] == 'PENDING'
    assert not published
    serve_rpc(monkeypatch, {HEARING: hearing_receipt(target, candidate, size)})
    docket.verify_hearing(candidate['candidate_id'], HEARING)
    assert docket.get_docket()['candidates'][-1]['jury_status'] == 'rejected'
    assert docket.get_settlement()['round'] == 0
    assert not published
    # Same funded round is retryable; no fee or challenge was consumed.
    warp(direct_vm, '2028-01-01T00:00:01Z')
    docket.propose()
    assert docket.get_docket()['candidates'][-1]['round'] == 1


def test_only_a_bound_finalized_independent_panel_can_authorize_vault(docket, direct_vm, monkeypatch):
    published = []
    vault_stub(monkeypatch, published)
    candidate, target = raw_candidate(docket, direct_vm)
    receipt = hearing_receipt(target, candidate)
    receipt['status'] = 'ACCEPTED'
    serve_rpc(monkeypatch, {HEARING: receipt})
    with direct_vm.expect_revert('not finalized'):
        docket.verify_hearing(candidate['candidate_id'], HEARING)
    receipt['status'] = 7
    receipt['to_address'] = '0x'+'f'*40
    with direct_vm.expect_revert('does not match'):
        docket.verify_hearing(candidate['candidate_id'], HEARING)
    receipt['to_address'] = target
    docket.verify_hearing(candidate['candidate_id'], HEARING)
    assert docket.get_settlement()['outcome'] == 'YES'
    assert docket.get_docket()['rounds'][0]['jury_status'] == 'verified'
    assert len(published) == 1
    with direct_vm.expect_revert('funded round'):
        docket.verify_hearing(candidate['candidate_id'], HEARING)


def test_rotations_idle_and_duplicate_identities_do_not_inflate_jury(docket, direct_vm, monkeypatch):
    candidate, target = raw_candidate(docket, direct_vm)
    receipt = hearing_receipt(target, candidate)
    # Old leaders are deliberately ignored; idle and duplicated members do not count.
    receipt['consensus_data']['leader_receipt'].insert(0, hearing_receipt(target, candidate, 9)['consensus_data']['leader_receipt'][0])
    receipt['consensus_data']['validators'][0]['vote'] = 'idle'
    receipt['consensus_data']['validators'][1]['node_config'] = receipt['consensus_data']['validators'][2]['node_config']
    serve_rpc(monkeypatch, {HEARING: receipt})
    docket.verify_hearing(candidate['candidate_id'], HEARING)
    assert docket.get_docket()['candidates'][-1]['panel_check']['observed'] == 3
    assert not docket.get_docket()['rounds']


def pending_payment(vault, vm, alice):
    c, state = vault
    vm.value = 10
    c.fund('q1')
    vm.value = 0
    warp(vm, '2028-01-01T02:00:01Z')
    c.claim_timeout('q1')
    c.withdraw(address(alice))
    payment = c.get_payment(address(alice))
    from genlayer import gl, Address
    target = str(gl.message.contract_address)
    parent = {'hash': PARENT, 'status': 7, 'to_address': target, 'triggered_transactions': [CHILD], 'consensus_data': {'leader_receipt': [{'mode': 'leader', 'execution_result': 'SUCCESS', 'genvm_result': {'stdout': json.dumps({'sortition_payment': {'id': payment['id'], 'beneficiary': str(Address(address(alice))), 'amount': payment['amount']}})}}]}}
    child = {'hash': CHILD, 'status': 7, 'type': 0, 'from_address': target, 'to_address': address(alice), 'value': '10', 'triggered_by': PARENT, 'value_credited': True}
    return c, payment, parent, child


def test_successful_native_transfer_cannot_be_restored_or_replayed(vault, direct_vm, direct_alice, monkeypatch):
    c, payment, parent, child = pending_payment(vault, direct_vm, direct_alice)
    serve_rpc(monkeypatch, {PARENT: parent, CHILD: child})
    direct_vm.value = 10
    with direct_vm.expect_revert('delivered payment'):
        c.restore_withdrawal(address(direct_alice), payment['id'], PARENT)
    direct_vm.value = 0
    c.confirm_withdrawal(address(direct_alice), payment['id'], PARENT)
    assert c.get_payment(address(direct_alice))['transfer_tx'] == CHILD
    assert c.get_credit(address(direct_alice)) == '0'
    with direct_vm.expect_revert('not pending'):
        c.confirm_withdrawal(address(direct_alice), payment['id'], PARENT)


def test_failed_transfer_false_relay_confirmation_and_backed_recovery(vault, direct_vm, direct_alice, direct_bob, monkeypatch):
    c, payment, parent, child = pending_payment(vault, direct_vm, direct_alice)
    child['value_credited'] = False
    serve_rpc(monkeypatch, {PARENT: parent, CHILD: child})
    with direct_vm.expect_revert('did not execute'):
        c.confirm_withdrawal(address(direct_alice), payment['id'], PARENT)
    assert c.get_payment(address(direct_alice))['status'] == 'pending'
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('Only the beneficiary'):
        c.confirm_withdrawal(address(direct_alice), payment['id'], PARENT)
    direct_vm.value = 9
    with direct_vm.expect_revert('exact native backing'):
        c.restore_withdrawal(address(direct_alice), payment['id'], PARENT)
    direct_vm.value = 10
    c.restore_withdrawal(address(direct_alice), payment['id'], PARENT)
    assert c.get_credit(address(direct_alice)) == '10'
    with direct_vm.expect_revert('not pending'):
        c.restore_withdrawal(address(direct_alice), payment['id'], PARENT)
    direct_vm.sender = direct_alice
    direct_vm.value = 0
    c.withdraw(address(direct_alice))
    assert c.get_payment(address(direct_alice))['id'] != payment['id']
    with direct_vm.expect_revert('does not match'):
        c.confirm_withdrawal(address(direct_alice), c.get_payment(address(direct_alice))['id'], PARENT)


@pytest.mark.parametrize('change', [{'status': 5}, {'value': '9'}, {'to_address': '0x'+'a'*40}, {'triggered_by': HEARING}, {'type': 2}, {'value_credited': None}])
def test_incorrect_or_unfinalized_transfer_proofs_preserve_recovery(vault, direct_vm, direct_alice, monkeypatch, change):
    c, payment, parent, child = pending_payment(vault, direct_vm, direct_alice)
    child.update(change)
    serve_rpc(monkeypatch, {PARENT: parent, CHILD: child})
    with pytest.raises(Exception):
        c.confirm_withdrawal(address(direct_alice), payment['id'], PARENT)
    assert c.get_payment(address(direct_alice))['status'] == 'pending'
    assert c.get_credit(address(direct_alice)) == '0'


def test_failed_native_appeal_cannot_disable_permissionless_escrow_exit(vault, direct_vm, direct_alice, direct_bob, monkeypatch):
    c, state = vault
    direct_vm.value = 10; c.fund('q1'); direct_vm.value = 0
    import genlayer
    # A native rollback can remove the docket entirely. The vault never needs
    # that contract's readable state to recover funds, only its own deadline.
    class MissingDocket:
        def emit(self, **kw): return self
        def close_settlement(self): pass
        def view(self, **kw): raise AssertionError('No foreign reads permitted')
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda a: MissingDocket())
    direct_vm.sender = direct_bob
    warp(direct_vm, '2028-01-01T02:00:01Z')
    c.claim_timeout('q1')
    assert c.get_account('q1')['outcome'] == 'REFUNDED'
    assert c.get_credit(address(direct_alice)) == '10'


def test_post_trading_close_final_outcome_is_valid(direct_vm, direct_deploy, direct_alice, spec, monkeypatch):
    spec.update(close_timestamp=1800000000, observation_timestamp=1800007200, resolution_timestamp=1800009000)
    c = deploy_docket(direct_deploy, spec, address(direct_alice), address(direct_alice), address(direct_alice))
    direct_vm.sender = direct_alice; c.prepare_round(0,5); vault_stub(monkeypatch)
    warp(direct_vm, '2027-01-15T09:30:00Z')  # Later verification uses explicit timestamp below.
    from datetime import datetime, timezone
    warp(direct_vm, datetime.fromtimestamp(1800005000, timezone.utc).isoformat())
    with direct_vm.expect_revert('still open'): c.propose()
    warp(direct_vm, datetime.fromtimestamp(1800010000, timezone.utc).isoformat())
    mock_hearing(direct_vm, body=BODY + ' Final result published after trading closed.')
    c.resolve()
    assert c.get_settlement()['outcome'] == 'YES'
    r = c.get_docket()['rounds'][0]
    assert r['observation_timestamp'] > r['closing_timestamp']


def test_changed_historical_snapshot_cannot_establish_earlier_state(direct_vm, direct_deploy, direct_alice, spec, monkeypatch):
    spec['evidence_mode'] = 'historical_state'
    for source in spec['sources']: source['content_sha256'] = hashlib.sha256(BODY.encode()).hexdigest()
    direct_vm.sender = direct_alice; warp(direct_vm, '2028-01-01T00:00:00Z')
    c = deploy_docket(direct_deploy, spec, address(direct_alice), address(direct_alice), address(direct_alice)); c.prepare_round(0,5); vault_stub(monkeypatch)
    mock_hearing(direct_vm, body=BODY + ' Corrected later: actually 4 percent.')
    c.resolve()
    assert c.get_settlement()['outcome'] == 'UNRESOLVABLE'
    assert all(s['evidence_reason'] == 'historical_snapshot_mismatch' for s in c.get_docket()['rounds'][0]['sources'])


def test_large_document_with_hidden_qualification_cannot_settle_yes(docket, direct_vm):
    mock_hearing(direct_vm, body=BODY + 'x'*280000 + 'Retracted: original statement is invalid.' + 'x'*30000)
    docket.resolve()
    assert docket.get_settlement()['outcome'] == 'UNRESOLVABLE'


def test_historical_hash_alone_does_not_prove_observation_time(docket, direct_vm):
    mock_hearing(direct_vm)
    direct_vm._llm_mocks.pop()
    direct_vm.mock_llm('(?s)auditing a locked prediction hearing.*', json.dumps({'unsupported_urls': [], 'temporal_supported_urls': [], 'unresolvable': False}))
    docket.resolve()
    assert docket.get_settlement()['outcome'] == 'UNRESOLVABLE'
