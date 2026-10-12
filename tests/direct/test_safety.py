from conftest import address, warp
import json
import hashlib
import pytest


def test_sponsored_winning_principal_belongs_to_payer(vault, direct_vm, direct_alice, direct_bob):
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    c.open_round('q1')
    direct_vm.value = 2
    c.challenge('q1', address(direct_bob), 'NO')
    state.update(round=2, outcome='NO')
    c.open_round('q1')
    warp(direct_vm, '2028-01-01T00:02:00Z')
    c.finalize('q1')
    assert c.get_credit(address(direct_bob)) == '0'
    assert c.get_credit(address(direct_alice)) == '12'
    assert c.get_account('q1')['challenges'][0]['payer'].lower() == address(direct_alice).lower()


def test_failed_payment_restore_requires_backing_and_cannot_replay(vault, direct_vm, direct_alice, direct_bob):
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    c.open_round('q1')
    direct_vm.value = 0
    warp(direct_vm, '2028-01-01T00:02:00Z')
    c.finalize('q1')
    c.withdraw(address(direct_alice))
    payment = c.get_payment(address(direct_alice))
    assert payment['amount'] == '10' and payment['status'] == 'pending'
    direct_vm.value = 9
    with direct_vm.expect_revert('exact native backing'):
        c.restore_withdrawal(address(direct_alice), payment['id'])
    direct_vm.value = 10
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('Only relay'):
        c.restore_withdrawal(address(direct_alice), payment['id'])
    direct_vm.sender = direct_alice
    c.restore_withdrawal(address(direct_alice), payment['id'])
    assert c.get_credit(address(direct_alice)) == '10'
    assert c.get_payment(address(direct_alice))['status'] == 'restored'
    with direct_vm.expect_revert('not pending'):
        c.restore_withdrawal(address(direct_alice), payment['id'])


def test_payment_delivery_confirmation_keeps_auditable_record(vault, direct_vm, direct_alice):
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    c.open_round('q1')
    direct_vm.value = 0
    warp(direct_vm, '2028-01-01T00:02:00Z')
    c.finalize('q1')
    c.withdraw(address(direct_alice))
    payment = c.get_payment(address(direct_alice))
    with direct_vm.expect_revert('not pending'):
        c.confirm_withdrawal(address(direct_alice), 'wrong-id')
    c.confirm_withdrawal(address(direct_alice), payment['id'])
    assert c.get_payment(address(direct_alice))['status'] == 'delivered'
    assert c.get_credit(address(direct_alice)) == '0'


def test_settlement_reads_only_final_foreign_state(vault, direct_vm, monkeypatch):
    c, _ = vault
    import genlayer
    from genlayer.py.public_abi import StorageType
    calls = []
    class Docket:
        def view(self, **kwargs):
            calls.append(kwargs)
            assert kwargs['state'] == StorageType.LATEST_FINAL
            return self
        def get_settlement(self):
            return {'outcome':'NO', 'round':1, 'deadline':1830297660}
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda a:Docket())
    direct_vm.value = 10
    c.fund('q1')
    c.open_round('q1')
    warp(direct_vm, '2028-01-01T00:02:00Z')
    c.finalize('q1')
    assert calls and c.get_account('q1')['outcome'] == 'NO'


def test_resolution_rejects_direct_caller_bypassing_relay(docket, direct_vm, direct_bob):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('registered relay'):
        docket.resolve()


def test_validator_binds_names_digest_and_citation(docket, direct_vm):
    direct_vm.mock_web('.*', {'status':200, 'body':'The final rate is 6 percent.'})
    direct_vm.mock_llm('.*Extract evidence.*', json.dumps({'position':'YES','value':'6 percent','evidence_line':1}))
    direct_vm.mock_llm('.*Evaluate ONLY.*', json.dumps({'unresolvable':False}))
    docket.resolve()
    result, _, validator = direct_vm._captured_validators[-1]
    from genlayer import gl
    assert validator(gl.vm.Return(result))
    for key, value in [('name','Invented authority'),('digest','0'*64),('excerpt','Invented quote')]:
        altered = json.loads(json.dumps(result))
        altered['sources'][0][key] = value
        assert not validator(gl.vm.Return(altered)), key
    altered = json.loads(json.dumps(result))
    altered['uncertainty_applies'] = True
    assert not validator(gl.vm.Return(altered))


@pytest.mark.parametrize('value', ['', ' '*8, 'x'*501])
def test_supported_readings_reject_empty_or_truncated_values(docket, direct_vm, value):
    direct_vm.mock_web('.*', {'status':200,'body':'The final rate is 6 percent.'})
    direct_vm.mock_llm('.*', json.dumps({'position':'YES','value':value,'evidence_line':1}))
    with direct_vm.expect_revert('Factual values'):
        docket.resolve()


def test_global_missing_source_exception_overrides_majority(direct_vm, direct_deploy, direct_alice, spec, monkeypatch):
    direct_vm.sender = direct_alice
    warp(direct_vm, '2028-01-01T00:00:00Z')
    spec['sources'].append({'name':'Official C','url':'https://c.example/rate'})
    spec['disagreement_rule'] = 'majority'
    spec['unresolvable_definition'] = 'If any source cannot be reached this market is unresolvable.'
    canonical = json.dumps(spec, sort_keys=True, separators=(',',':'))
    c = direct_deploy('contracts/sortition_docket.py', canonical, hashlib.sha256(canonical.encode()).hexdigest(), address(direct_alice), 'q', 60, address(direct_alice))
    import genlayer
    class Vault:
        def view(self, **kwargs):return self
        def get_account(self, key):return {'funded':True,'settled':False,'challenge_count':0}
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda a:Vault())
    for source in spec['sources'][:2]:
        direct_vm.mock_web(source['url'], {'status':200,'body':'The final rate is 6 percent.'})
    direct_vm.mock_web(spec['sources'][2]['url'], {'status':503,'body':''})
    direct_vm.mock_llm('.*Extract evidence.*', json.dumps({'position':'YES','value':'6 percent','evidence_line':1}))
    # Matching the URL in the actual global prompt verifies the full bundle is supplied.
    direct_vm.mock_llm('(?s).*Evaluate ONLY.*https://c.example/rate.*', json.dumps({'unresolvable':True}))
    c.resolve()
    assert c.get_settlement()['outcome'] == 'UNRESOLVABLE'
    assert c.get_docket()['rounds'][0]['uncertainty_applies']


def test_challenge_window_begins_after_finalized_ruling_is_observed(vault, direct_vm):
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    # The old proposal timestamp is already expired, but finality just arrived.
    warp(direct_vm, '2028-01-01T00:02:00Z')
    c.open_round('q1')
    assert c.get_account('q1')['round_deadline'] == state['deadline'] + 120
    with direct_vm.expect_revert('expired'):
        c.finalize('q1')
    with direct_vm.expect_revert('new finalized ruling'):
        c.open_round('q1')
    warp(direct_vm, '2028-01-01T00:03:00Z')
    c.finalize('q1')
    assert c.get_account('q1')['settled']
