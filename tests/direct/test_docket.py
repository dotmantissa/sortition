from conftest import address, warp
import json
import hashlib
import pytest

def evidence(vm, position='YES', value='6 percent'):
    vm.mock_web(r'https://.*\.example/rate', {'status': 200, 'body': 'The final rate is 6 percent.'})
    vm.mock_llm(r'.*Extract evidence.*', json.dumps({'position': position, 'value': value, 'excerpt': '6 percent'}))

def test_resolve_reads_all_sources(docket, direct_vm):
    evidence(direct_vm)
    docket.resolve()
    r = docket.get_docket()['rounds'][0]
    assert r['outcome'] == 'YES'
    assert len(r['sources']) == 2
    assert all(s['digest'] == hashlib.sha256(b'The final rate is 6 percent.').hexdigest() for s in r['sources'])
    assert docket.get_settlement()['round'] == 1
    with direct_vm.expect_revert('funded challenge'):
        docket.resolve()

def test_missing_sources_is_real_outcome(docket, direct_vm):
    direct_vm.mock_web('.*', {'status': 503, 'body': ''})
    docket.resolve()
    assert docket.get_settlement()['outcome'] == 'UNRESOLVABLE'
    assert all(not s['reachable'] for s in docket.get_docket()['rounds'][0]['sources'])

def test_ambiguous_evidence(docket, direct_vm):
    evidence(direct_vm, 'UNKNOWN', '')
    docket.resolve()
    assert docket.get_settlement()['outcome'] == 'UNRESOLVABLE'

@pytest.mark.parametrize('reply', [{'position': 'MAYBE', 'value': '6'}, {'position': 'YES', 'value': '6', 'excerpt': 'fabricated quote'}, 'not json'])
def test_bad_model_response_reverts(docket, direct_vm, reply):
    direct_vm.mock_web('.*', {'status': 200, 'body': 'Actual source.'})
    direct_vm.mock_llm('.*', json.dumps(reply) if isinstance(reply, dict) else reply)
    with direct_vm.expect_revert('LLM_ERROR'):
        docket.resolve()
    assert docket.get_settlement()['outcome'] == 'PENDING'

def test_before_close(docket, direct_vm):
    warp(direct_vm, '2026-01-01T00:00:00Z')
    with direct_vm.expect_revert('still open'):
        docket.resolve()

def test_validator_rechecks_value_and_reachability(docket, direct_vm):
    evidence(direct_vm)
    docket.resolve()
    result, leader_fn, validator = direct_vm._captured_validators[-1]
    from genlayer import gl
    assert validator(gl.vm.Return(result))
    changed = json.loads(json.dumps(result))
    changed['sources'][0]['value'] = 'wrong intermediate value'
    assert not validator(gl.vm.Return(changed))
    changed = json.loads(json.dumps(result))
    changed['sources'][0]['reachable'] = False
    assert not validator(gl.vm.Return(changed))
    changed = json.loads(json.dumps(result))
    changed['outcome'] = 'NO'
    assert not validator(gl.vm.Return(changed))

def test_hash_mismatch(direct_vm, direct_deploy, direct_alice, spec):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert('hash mismatch'):
        direct_deploy('contracts/sortition_docket.py', json.dumps(spec), 'bad', address(direct_alice), 'q', 60)
