from conftest import address, warp, deploy_docket, vault_stub, mock_hearing, BODY, QUOTE
import json
import hashlib
import pytest

def test_resolve_reads_all_sources(docket, direct_vm):
    mock_hearing(direct_vm)
    docket.resolve()
    r = docket.get_docket()['rounds'][0]
    assert r['outcome'] == 'YES'
    assert len(r['sources']) == 2
    assert all(s['digest'] == hashlib.sha256(BODY.encode()).hexdigest() for s in r['sources'])
    assert docket.get_settlement()['round'] == 1
    with direct_vm.expect_revert('funded challenge'):
        docket.resolve()

def test_absent_document_is_a_real_outcome(docket, direct_vm):
    # A 404 is a repeatable statement that the document is not there.
    direct_vm.mock_web('.*', {'status': 404, 'body': ''})
    direct_vm.mock_llm(r'(?s)auditing a locked prediction hearing.*', json.dumps({'unsupported_urls': [], 'unresolvable': False}))
    docket.resolve()
    assert docket.get_settlement()['outcome'] == 'UNRESOLVABLE'
    sources = docket.get_docket()['rounds'][0]['sources']
    assert all(not s['reachable'] and s['status'] == 404 for s in sources)

@pytest.mark.parametrize('status', [500, 502, 503, 408, 429])
def test_temporary_failure_never_becomes_a_verdict(docket, direct_vm, status):
    # A timeout or server fault must fail the hearing instead of settling it.
    direct_vm.mock_web('.*', {'status': status, 'body': ''})
    with direct_vm.expect_revert('TRANSIENT'):
        docket.resolve()
    assert docket.get_settlement()['outcome'] == 'PENDING'

def test_validators_agree_on_a_shared_temporary_failure(docket, direct_vm):
    mock_hearing(direct_vm)
    docket.resolve()
    _, _, validator = direct_vm._captured_validators[-1]
    class Rollback:
        message = '[TRANSIENT] Evidence source is temporarily unreachable (HTTP 503)'
    class Other:
        message = '[LLM_ERROR] Invalid extracted evidence'
    # This validator can still read the source, so a failed leader is wrong.
    assert not validator(Rollback())
    direct_vm.clear_mocks()
    direct_vm.mock_web('.*', {'status': 503, 'body': ''})
    # Both participants met the same outage. Agreeing on the failure keeps the
    # hearing retryable instead of recording an unverified verdict.
    assert validator(Rollback())
    assert not validator(Other())

def test_ambiguous_evidence(docket, direct_vm):
    mock_hearing(direct_vm, 'UNKNOWN', '', quote=None)
    docket.resolve()
    assert docket.get_settlement()['outcome'] == 'UNRESOLVABLE'

def test_stored_quotation_is_centred_on_the_located_fact(docket, direct_vm):
    # The supporting fact sits far past the opening of a single line document,
    # exactly the minified case where a leading prefix proves nothing.
    body = 'x' * 4000 + ' ' + QUOTE + ' per the official release. ' + 'y' * 4000
    mock_hearing(direct_vm, body=body)
    docket.resolve()
    for s in docket.get_docket()['rounds'][0]['sources']:
        assert s['quote'] == QUOTE
        assert QUOTE in s['excerpt']
        assert s['quote_offset'] == 4001
        assert len(s['excerpt']) <= 900
        assert s['excerpt'] != body[:len(s['excerpt'])]

def test_oversized_document_still_reaches_the_fact(docket, direct_vm):
    # Beyond the offered budget the contract keeps keyword windows, so a fact
    # deep inside a very large document is still citable and verifiable.
    body = 'z' * 300000 + ' the official rate release says ' + QUOTE + '. ' + 'z' * 60000
    mock_hearing(direct_vm, body=body)
    docket.resolve()
    sources = docket.get_docket()['rounds'][0]['sources']
    assert all(s['document_is_partial'] and s['document_characters'] == len(body) for s in sources)
    assert all(QUOTE in s['excerpt'] for s in sources)

@pytest.mark.parametrize('quote,message', [
    (None, 'supporting quotation'),
    ('too short', 'supporting quotation'),
    ('a fabricated sentence that never appears in the document', 'not found in source'),
])
def test_unverifiable_quotation_reverts(docket, direct_vm, quote, message):
    mock_hearing(direct_vm, quote=quote)
    with direct_vm.expect_revert(message):
        docket.resolve()
    assert docket.get_settlement()['outcome'] == 'PENDING'

def test_quotation_that_does_not_support_the_value_is_rejected(docket, direct_vm):
    # Membership in the document is not support. The audit stage decides.
    mock_hearing(direct_vm, quote='Official release. The final rate', unsupported=['https://a.example/rate'])
    with direct_vm.expect_revert('does not support'):
        docket.resolve()

@pytest.mark.parametrize('reply', [{'position': 'MAYBE', 'value': '6'}, {'position': 'YES', 'value': ''}, 'not json'])
def test_bad_model_response_reverts(docket, direct_vm, reply):
    direct_vm.mock_web('.*', {'status': 200, 'body': BODY})
    direct_vm.mock_llm(r'(?s)Extract evidence.*', json.dumps(reply) if isinstance(reply, dict) else reply)
    direct_vm.mock_llm(r'(?s)auditing a locked prediction hearing.*', json.dumps({'unsupported_urls': [], 'unresolvable': False}))
    with direct_vm.expect_revert('LLM_ERROR'):
        docket.resolve()
    assert docket.get_settlement()['outcome'] == 'PENDING'

@pytest.mark.parametrize('reply', [{'unresolvable': 'maybe'}, {'unsupported_urls': 'all', 'unresolvable': True}, 'not json'])
def test_bad_audit_response_reverts(docket, direct_vm, reply):
    direct_vm.mock_web('.*', {'status': 200, 'body': BODY})
    direct_vm.mock_llm(r'(?s)Extract evidence.*', json.dumps({'position': 'YES', 'value': '6 percent', 'quote': QUOTE}))
    direct_vm.mock_llm(r'(?s)auditing a locked prediction hearing.*', json.dumps(reply) if isinstance(reply, dict) else reply)
    with direct_vm.expect_revert('LLM_ERROR'):
        docket.resolve()

def test_before_close(docket, direct_vm):
    warp(direct_vm, '2026-01-01T00:00:00Z')
    with direct_vm.expect_revert('still open'):
        docket.resolve()

def test_both_model_stages_receive_the_close_and_the_real_document(docket, direct_vm):
    # The mocks only answer when the prompt actually carries the locked closing
    # time, and the audit only answers when it carries document text around the
    # quotation rather than a bare value and digest.
    direct_vm.mock_web('.*', {'status': 200, 'body': BODY})
    direct_vm.mock_llm(r'(?s)Extract evidence.*"closing_timestamp": 1800000000.*"document": "Official release\. The final rate',
                       json.dumps({'position': 'YES', 'value': '6 percent', 'quote': QUOTE}))
    direct_vm.mock_llm(r'(?s)auditing a locked prediction hearing.*"closing_timestamp": 1800000000.*"quotation": "The final rate is 6 percent".*"document_context_around_quotation": "Official release\. The final rate is 6 percent at the close of business\."',
                       json.dumps({'unsupported_urls': [], 'unresolvable': False}))
    docket.resolve()
    assert docket.get_docket()['rounds'][0]['closing_timestamp'] == 1800000000
    assert docket.get_settlement()['outcome'] == 'YES'

def test_validator_rechecks_value_and_reachability(docket, direct_vm):
    mock_hearing(direct_vm)
    docket.resolve()
    result, leader_fn, validator = direct_vm._captured_validators[-1]
    from genlayer import gl
    assert validator(gl.vm.Return(result))
    for key, value in [('value', 'wrong intermediate value'), ('reachable', False), ('position', 'NO'), ('source_changed', True)]:
        changed = json.loads(json.dumps(result))
        changed['sources'][0][key] = value
        assert not validator(gl.vm.Return(changed)), key
    for key, value in [('outcome', 'NO'), ('uncertainty_applies', True)]:
        changed = json.loads(json.dumps(result))
        changed[key] = value
        assert not validator(gl.vm.Return(changed)), key

def test_validator_accepts_alternative_provenance_but_not_invented_quotes(docket, direct_vm):
    mock_hearing(direct_vm)
    docket.resolve()
    result, _, validator = direct_vm._captured_validators[-1]
    from genlayer import gl
    # A changed whole document digest or a different valid citation window must
    # not break a hearing whose factual conclusions agree.
    tolerated = json.loads(json.dumps(result))
    tolerated['sources'][0]['digest'] = '0' * 64
    tolerated['sources'][0]['excerpt'] = QUOTE
    tolerated['sources'][0]['quote'] = 'final rate is 6 percent at the close'
    assert validator(gl.vm.Return(tolerated))
    # A quotation that is absent from this validator's own document is not.
    for quote in ['Invented quote that is long enough', 'short']:
        invented = json.loads(json.dumps(result))
        invented['sources'][0]['quote'] = quote
        assert not validator(gl.vm.Return(invented)), quote
    assert not validator(gl.vm.Return({'outcome': 'YES', 'uncertainty_applies': False}))
    assert not validator(gl.vm.Return('not a reading'))

def test_hash_mismatch(direct_vm, direct_deploy, direct_alice, spec):
    direct_vm.sender = direct_alice
    canonical = json.dumps(spec, sort_keys=True, separators=(',', ':'))
    with direct_vm.expect_revert('hash mismatch'):
        direct_deploy('contracts/sortition_docket.py', canonical, 'bad', address(direct_alice), 'q', 60, address(direct_alice), address(direct_alice), 3600)

def test_relay_grace_bounds(direct_vm, direct_deploy, direct_alice, spec):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert('relay grace'):
        deploy_docket(direct_deploy, spec, address(direct_alice), address(direct_alice), address(direct_alice), grace=59)

@pytest.mark.parametrize('policy,positions,expected', [
    ('majority',['YES','YES','NO'],'YES'),
    ('majority',['YES','UNKNOWN','NO'],'UNRESOLVABLE'),
    ('unanimous',['NO','NO','NO'],'NO'),
    ('unanimous',['YES','YES','NO'],'UNRESOLVABLE'),
    ('tie_break',['YES','YES','NO'],'YES'),
    ('tie_break',['NO','YES','YES'],'NO'),
    ('tie_break',['YES','UNKNOWN','YES'],'UNRESOLVABLE'),
])
def test_registered_disagreement_policies(direct_vm,direct_deploy,direct_alice,spec,monkeypatch,policy,positions,expected):
    direct_vm.sender=direct_alice
    warp(direct_vm,'2028-01-01T00:00:00Z')
    spec['sources'].append({'name':'Official C','url':'https://c.example/rate'})
    spec['disagreement_rule']=policy
    c = deploy_docket(direct_deploy, spec, address(direct_alice), address(direct_alice), address(direct_alice), question_id='q')
    c.prepare_round(0, 5)
    vault_stub(monkeypatch)
    direct_vm.mock_llm(r'(?s)auditing a locked prediction hearing.*', json.dumps({'unsupported_urls': [], 'unresolvable': False}))
    for source,position in zip(spec['sources'],positions):
        direct_vm.mock_web(source['url'],{'status':200,'body':BODY})
        reply = {'position':position,'value':'6 percent' if position != 'UNKNOWN' else ''}
        if position != 'UNKNOWN':
            reply['quote'] = QUOTE
        direct_vm.mock_llm(r'(?s)Extract evidence.*'+source['url'],json.dumps(reply))
    c.resolve()
    assert c.get_settlement()['outcome']==expected

def test_only_finalized_vault_messages_prepare_and_close_a_hearing(docket, direct_vm, direct_bob):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('Only vault'):
        docket.prepare_round(1, 7)
    with direct_vm.expect_revert('Only vault'):
        docket.close_settlement()

def test_settled_docket_rejects_further_resolution(docket, direct_vm):
    docket.close_settlement()
    with direct_vm.expect_revert('final'):
        docket.resolve()

def test_funded_panel_requirement_is_recorded_with_the_ruling(docket, direct_vm):
    # The contract cannot seat validators, so it records the panel each round
    # was funded for and leaves the actual receipt publicly checkable.
    assert docket.get_docket()['required_validators'] == 5
    mock_hearing(direct_vm)
    docket.resolve()
    assert docket.get_docket()['rounds'][0]['required_validators'] == 5
    assert docket.get_settlement()['required_validators'] == 5

def test_any_account_may_request_a_hearing_after_the_relay_grace_period(direct_vm, direct_deploy, direct_alice, direct_bob, spec, monkeypatch):
    direct_vm.sender = direct_alice
    warp(direct_vm, '2028-01-01T00:00:00Z')
    c = deploy_docket(direct_deploy, spec, address(direct_alice), address(direct_alice), address(direct_alice))
    c.prepare_round(0, 5)
    vault_stub(monkeypatch)
    mock_hearing(direct_vm)
    assert c.get_docket()['open_to_anyone_after'] == 1800000000 + 3600
    direct_vm.sender = direct_bob
    warp(direct_vm, '2028-01-01T00:00:00Z')
    # The locked close is long past here, so the grace period has also expired
    # and a quiet relay can no longer strand the funded docket.
    c.resolve()
    assert c.get_settlement()['outcome'] == 'YES'

def test_relay_keeps_a_head_start_before_the_grace_period_expires(direct_vm, direct_deploy, direct_alice, direct_bob, spec, monkeypatch):
    direct_vm.sender = direct_alice
    spec['close_timestamp'] = 1830297600
    warp(direct_vm, '2028-01-01T00:00:00Z')
    c = deploy_docket(direct_deploy, spec, address(direct_alice), address(direct_alice), address(direct_alice))
    c.prepare_round(0, 5)
    vault_stub(monkeypatch)
    mock_hearing(direct_vm)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('grace period'):
        c.resolve()
    direct_vm.sender = direct_alice
    c.resolve()
    assert c.get_settlement()['outcome'] == 'YES'

def test_registry_can_rotate_a_lost_relay_key(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, spec, monkeypatch):
    direct_vm.sender = direct_alice
    spec['close_timestamp'] = 1830297600
    warp(direct_vm, '2028-01-01T00:00:00Z')
    # A distinct registry address proves the rotation is authenticated.
    c = deploy_docket(direct_deploy, spec, address(direct_alice), address(direct_alice), address(direct_charlie))
    c.prepare_round(0, 5)
    vault_stub(monkeypatch)
    mock_hearing(direct_vm)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('Only the registry'):
        c.set_relay(address(direct_bob))
    direct_vm.sender = direct_charlie
    c.set_relay(address(direct_bob))
    assert c.get_docket()['relay'].lower() == address(direct_bob).lower()
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert('grace period'):
        c.resolve()
    direct_vm.sender = direct_bob
    c.resolve()
    assert c.get_settlement()['outcome'] == 'YES'

def test_anyone_can_republish_an_immutable_stored_ruling(docket, direct_vm, direct_bob, monkeypatch):
    rulings = []
    vault_stub(monkeypatch, rulings)
    with direct_vm.expect_revert('No stored ruling'):
        docket.publish_ruling()
    mock_hearing(direct_vm)
    docket.resolve()
    direct_vm.sender = direct_bob
    docket.publish_ruling()
    assert rulings[-1] == ('q1', 'YES', 1, docket.get_docket()['criteria_hash'])

def test_rehearing_carries_the_first_hearing_record_and_flags_a_changed_source(docket, direct_vm):
    mock_hearing(direct_vm)
    docket.resolve()
    first = docket.get_docket()['rounds'][0]['sources'][0]
    assert first['source_changed'] is False
    docket.prepare_round(1, 7)
    # The same question, a changed document. The jury can tell the difference
    # between a moved source and an earlier mistaken reading.
    changed = 'Correction notice. ' + QUOTE + ' was restated at the close of business.'
    direct_vm.clear_mocks()
    mock_hearing(direct_vm, body=changed)
    docket.resolve()
    second = docket.get_docket()['rounds'][1]['sources'][0]
    assert second['source_changed'] is True
    assert second['digest'] != first['digest']
    assert docket.get_docket()['rounds'][1]['required_validators'] == 7
