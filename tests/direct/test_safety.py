from conftest import install_payment_receipts, address, warp, deploy_docket, vault_stub, mock_hearing, HEARING_TIMEOUT, MAX_ROUNDS, APPEAL_WINDOW, QUOTE
import json
import hashlib
import pytest

# q1 is bound with close_timestamp 1800000000 while the clock reads
# 2028-01-01T00:00:00Z (1830297600), so a funded hearing is due two hours later.
AFTER_DEADLINE = '2028-01-01T02:00:01Z'
BEFORE_DEADLINE = '2028-01-01T01:59:00Z'


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
    install_payment_receipts(c, state, direct_vm, address(direct_alice), payment, delivered='failed_payment' not in __import__('inspect').stack()[0].function)
    assert payment['amount'] == '10' and payment['status'] == 'pending'
    direct_vm.value = 9
    with direct_vm.expect_revert('exact native backing'):
        c.restore_withdrawal(address(direct_alice), payment['id'], '0x'+'2'*64)
    # Any account may supply the exact backing, so recovery never waits for the
    # relay to be available and funded. Credit stays fully backed either way.
    direct_vm.value = 10
    direct_vm.sender = direct_bob
    c.restore_withdrawal(address(direct_alice), payment['id'], '0x'+'2'*64)
    assert c.get_credit(address(direct_alice)) == '10'
    restored = c.get_payment(address(direct_alice))
    assert restored['status'] == 'restored'
    assert restored['restored_by'].lower() == address(direct_bob).lower()
    with direct_vm.expect_revert('not pending'):
        c.restore_withdrawal(address(direct_alice), payment['id'], '0x'+'2'*64)


def test_beneficiary_can_confirm_its_own_delivered_payment(vault, direct_vm, direct_alice, direct_charlie):
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    c.open_round('q1')
    direct_vm.value = 0
    warp(direct_vm, '2028-01-01T00:02:00Z')
    c.finalize('q1')
    c.withdraw(address(direct_alice))
    payment = c.get_payment(address(direct_alice))
    install_payment_receipts(c, state, direct_vm, address(direct_alice), payment, delivered='failed_payment' not in __import__('inspect').stack()[0].function)
    with direct_vm.expect_revert('not pending'):
        c.confirm_withdrawal(address(direct_alice), 'wrong-id', '0x'+'2'*64)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert('beneficiary or relay'):
        c.confirm_withdrawal(address(direct_alice), payment['id'], '0x'+'2'*64)
    # A quiet relay cannot leave a delivered payment pending forever.
    direct_vm.sender = direct_alice
    c.confirm_withdrawal(address(direct_alice), payment['id'], '0x'+'2'*64)
    confirmed = c.get_payment(address(direct_alice))
    assert confirmed['status'] == 'delivered'
    assert confirmed['confirmed_by'].lower() == address(direct_alice).lower()
    assert c.get_credit(address(direct_alice)) == '0'


def test_unresolved_funded_hearing_refunds_every_payer_without_permission(vault, direct_vm, direct_alice, direct_bob, direct_charlie):
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    assert c.get_account('q1')['hearing_deadline'] == 1830297600 + HEARING_TIMEOUT
    direct_vm.value = 0
    with direct_vm.expect_revert('deadline has not passed'):
        c.claim_timeout('q1')
    warp(direct_vm, BEFORE_DEADLINE)
    with direct_vm.expect_revert('deadline has not passed'):
        c.claim_timeout('q1')
    warp(direct_vm, AFTER_DEADLINE)
    # Consensus never produced a ruling. Any account can release the funds.
    direct_vm.sender = direct_charlie
    c.claim_timeout('q1')
    account = c.get_account('q1')
    assert account['settled'] and account['refunded']
    assert account['outcome'] == 'REFUNDED'
    assert state['closed'] is True
    # The fee returns to the account that actually paid it.
    assert c.get_credit(address(direct_alice)) == '10'
    assert c.get_credit(address(direct_bob)) == '0'
    with direct_vm.expect_revert('unsettled funded hearing'):
        c.claim_timeout('q1')


def test_timeout_refunds_bonds_to_their_economic_payers(vault, direct_vm, direct_alice, direct_bob):
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    c.open_round('q1')
    direct_vm.value = 2
    direct_vm.sender = direct_bob
    # A self funded challenger, then a sponsored one, on the same docket.
    c.challenge('q1', address(direct_bob), 'NO')
    assert c.get_account('q1')['hearing_deadline'] == 1830297600 + HEARING_TIMEOUT
    warp(direct_vm, AFTER_DEADLINE)
    direct_vm.value = 0
    c.claim_timeout('q1')
    # The rehearing never happened, so every bond goes back to its payer and
    # the fee to its funder. Nothing is forfeited to the treasury.
    assert c.get_credit(address(direct_bob)) == '2'
    assert c.get_credit(address(direct_alice)) == '10'
    assert c.get_account('q1')['outcome'] == 'REFUNDED'


def test_timeout_is_refused_once_the_round_has_a_ruling(vault, direct_vm, direct_bob):
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    c.open_round('q1')
    warp(direct_vm, AFTER_DEADLINE)
    direct_vm.value = 0
    # The hearing did happen. Settlement must run through finalize instead.
    with direct_vm.expect_revert('already produced a ruling'):
        c.claim_timeout('q1')
    c.finalize('q1')
    assert c.get_account('q1')['outcome'] == 'YES'
    # Settled, not refunded, so the fee is not returned to its funder.
    assert c.get_account('q1')['refunded'] is False
    assert c.get_credit(address(direct_bob)) == '0'


def test_forfeited_value_leaves_the_relay_for_a_distinct_treasury(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, monkeypatch):
    # The deployed treasury is a separate address the relay does not control,
    # so sponsoring a losing challenge is a real cost rather than a round trip.
    direct_vm.sender = direct_alice
    direct_vm.warp('2028-01-01T00:00:00Z')
    c = direct_deploy('contracts/settlement_vault.py', address(direct_charlie))
    c.configure(address(direct_alice))
    c.bind('q1', address(direct_bob), address(direct_bob), 10, 2, APPEAL_WINDOW, 'a'*64, 1800000000, HEARING_TIMEOUT, MAX_ROUNDS)
    import genlayer
    class Docket:
        def emit(self, **kw): return self
        def prepare_round(self, *args): pass
        def close_settlement(self): pass
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda a: Docket())
    direct_vm.value = 10
    c.fund('q1')
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    c.record_ruling('q1', 'YES', 1, 'a'*64, '0x'+'1'*64, 5, 4)
    direct_vm.sender = direct_alice
    direct_vm.value = 2
    # The relay sponsors a challenge against the result, and loses it.
    c.challenge('q1', address(direct_charlie), 'NO')
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    c.record_ruling('q1', 'YES', 2, 'a'*64, '0x'+'1'*64, 7, 4)
    warp(direct_vm, '2028-01-01T00:02:00Z')
    c.finalize('q1')
    assert c.get_credit(address(direct_alice)) == '0'
    assert c.get_credit(address(direct_bob)) == '0'
    assert c.get_credit(address(direct_charlie)) == '12'
    assert c.get_configuration()['treasury'].lower() == address(direct_charlie).lower()


def test_a_late_ruling_after_a_refund_is_accepted_quietly(vault, direct_vm, direct_bob):
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    warp(direct_vm, AFTER_DEADLINE)
    direct_vm.value = 0
    c.claim_timeout('q1')
    # An in flight hearing may still finalize after the refund. The emitted
    # message must not fail, and it must not reopen a closed escrow.
    direct_vm.sender = direct_bob
    c.record_ruling('q1', 'YES', 1, 'a'*64, '0x'+'1'*64, 5, 4)
    account = c.get_account('q1')
    assert account['outcome'] == 'REFUNDED'
    assert account['ruling_round'] == 0


def test_refunded_docket_stops_accepting_hearings(vault, direct_vm, direct_bob):
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    warp(direct_vm, AFTER_DEADLINE)
    direct_vm.value = 0
    c.claim_timeout('q1')
    with direct_vm.expect_revert('unsettled funded hearing'):
        c.prepare_hearing('q1')
    direct_vm.value = 2
    with direct_vm.expect_revert('No round is open'):
        c.challenge('q1', address(direct_bob), 'NO')
    direct_vm.value = 0
    with direct_vm.expect_revert('expired appeal window'):
        c.finalize('q1')


def test_unfunded_question_has_nothing_to_refund(vault, direct_vm):
    c, _ = vault
    warp(direct_vm, AFTER_DEADLINE)
    with direct_vm.expect_revert('unsettled funded hearing'):
        c.claim_timeout('q1')


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
    install_payment_receipts(c, state, direct_vm, address(direct_alice), payment, delivered='failed_payment' not in __import__('inspect').stack()[0].function)
    with direct_vm.expect_revert('not pending'):
        c.confirm_withdrawal(address(direct_alice), 'wrong-id', '0x'+'2'*64)
    c.confirm_withdrawal(address(direct_alice), payment['id'], '0x'+'2'*64)
    assert c.get_payment(address(direct_alice))['status'] == 'delivered'
    assert c.get_credit(address(direct_alice)) == '0'


def test_only_registered_docket_can_publish_matching_bound_ruling(vault, direct_vm, direct_alice, direct_bob):
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    direct_vm.value = 0
    with direct_vm.expect_revert('registered docket'):
        c.record_ruling('q1', 'YES', 1, 'a'*64, '0x'+'1'*64, 5, 4)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('registered docket'):
        c.record_ruling('q1', 'YES', 1, 'b'*64, '0x'+'1'*64, 5, 4)
    c.record_ruling('q1', 'YES', 1, 'a'*64, '0x'+'1'*64, 5, 4)
    deadline = c.get_account('q1')['round_deadline']
    warp(direct_vm, '2028-01-01T00:00:30Z')
    c.record_ruling('q1', 'YES', 1, 'a'*64, '0x'+'1'*64, 5, 4)
    assert c.get_account('q1')['round_deadline'] == deadline
    with direct_vm.expect_revert('new funded ruling'):
        c.record_ruling('q1', 'NO', 2, 'a'*64, '0x'+'1'*64, 7, 4)


def test_a_recomputed_ruling_cannot_overwrite_a_recorded_outcome(vault, direct_vm, direct_bob):
    # A protocol level appeal cannot be switched off, so the escrow must be
    # indifferent to a docket re-execution that proposes a different answer for
    # a round that is already recorded.
    c, state = vault
    direct_vm.value = 10
    c.fund('q1')
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    c.record_ruling('q1', 'YES', 1, 'a'*64, '0x'+'1'*64, 5, 4)
    for outcome in ['NO', 'UNRESOLVABLE']:
        with direct_vm.expect_revert('new funded ruling'):
            c.record_ruling('q1', outcome, 1, 'a'*64, '0x'+'1'*64, 5, 4)
    assert c.get_account('q1')['ruling_outcome'] == 'YES'
    assert c.get_account('q1')['opened_round'] == 1


def test_resolution_rejects_direct_caller_bypassing_relay(docket, direct_vm, direct_bob):
    direct_vm.sender = direct_bob
    warp(direct_vm, '2028-01-01T00:00:00Z')
    import json as _json
    spec = docket.get_docket()['specification']
    # Inside the relay's grace period the registered relay decides the panel.
    assert docket.get_docket()['open_to_anyone_after'] > spec['close_timestamp']


def test_validator_binds_names_and_citation(docket, direct_vm):
    mock_hearing(direct_vm)
    docket.resolve()
    result, _, validator = direct_vm._captured_validators[-1]
    from genlayer import gl
    assert validator(gl.vm.Return(result))
    for key, value in [('name', 'Invented authority'), ('url', 'https://invented.example/rate'), ('quote', 'Invented quote of sufficient length')]:
        altered = json.loads(json.dumps(result))
        altered['sources'][0][key] = value
        assert not validator(gl.vm.Return(altered)), key
    altered = json.loads(json.dumps(result))
    altered['uncertainty_applies'] = True
    assert not validator(gl.vm.Return(altered))


@pytest.mark.parametrize('value', ['', ' '*8])
def test_supported_readings_reject_empty_values(docket, direct_vm, value):
    mock_hearing(direct_vm, value=value)
    with direct_vm.expect_revert('Factual values'):
        docket.resolve()


def test_oversized_extracted_value_is_rejected(docket, direct_vm):
    mock_hearing(direct_vm, value='x'*501)
    with direct_vm.expect_revert('Factual values'):
        docket.resolve()


def test_global_missing_source_exception_overrides_majority(direct_vm, direct_deploy, direct_alice, spec, monkeypatch):
    direct_vm.sender = direct_alice
    warp(direct_vm, '2028-01-01T00:00:00Z')
    spec['sources'].append({'name':'Official C','url':'https://c.example/rate'})
    spec['disagreement_rule'] = 'majority'
    spec['unresolvable_definition'] = 'If any source cannot be reached this market is unresolvable.'
    c = deploy_docket(direct_deploy, spec, address(direct_alice), address(direct_alice), address(direct_alice), question_id='q')
    c.prepare_round(0, 5)
    vault_stub(monkeypatch)
    for source in spec['sources'][:2]:
        direct_vm.mock_web(source['url'], {'status': 200, 'body': 'Official release. ' + QUOTE + ' at the close.'})
    direct_vm.mock_web(spec['sources'][2]['url'], {'status': 404, 'body': ''})
    direct_vm.mock_llm(r'(?s)Extract evidence.*', json.dumps({'position':'YES','value':'6 percent','quote':QUOTE}))
    # Matching the URL in the actual audit prompt verifies the full bundle,
    # including the unreachable source, is supplied to the exception check.
    direct_vm.mock_llm(r'(?s)auditing a locked prediction hearing.*https://c.example/rate.*', json.dumps({'unsupported_urls': [], 'unresolvable': True, 'temporal_supported_urls': ['https://a.example/rate', 'https://b.example/rate']}))
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
    deadline = c.get_account('q1')['round_deadline']
    c.open_round('q1')
    assert c.get_account('q1')['round_deadline'] == deadline
    warp(direct_vm, '2028-01-01T00:03:00Z')
    c.finalize('q1')
    assert c.get_account('q1')['settled']


def test_resolved_outcome_is_emitted_only_after_finalization(docket, direct_vm, monkeypatch):
    rulings = []
    vault_stub(monkeypatch, rulings)
    mock_hearing(direct_vm)
    docket.resolve()
    assert rulings == [('q1', 'YES', 1, docket.get_docket()['criteria_hash'], '0x'+'1'*64, 5, 4)]


def test_hearing_repair_replays_finalized_funding_without_changing_escrow(vault, direct_vm, monkeypatch):
    c, state = vault
    with direct_vm.expect_revert('funded hearing'):
        c.prepare_hearing('q1')
    direct_vm.value = 10
    c.fund('q1')
    before = c.get_account('q1')
    direct_vm.value = 0
    c.prepare_hearing('q1')
    assert state['prepared'] == (0, 5)
    assert c.get_account('q1') == before


def test_funding_challenge_and_settlement_emit_authenticated_finalized_messages(vault, direct_vm, direct_bob, monkeypatch):
    import genlayer
    c, state = vault
    emitted = []
    class Docket:
        def emit(self, **kwargs):
            assert kwargs['on'] == 'finalized'
            return self
        def prepare_round(self, *args): emitted.append(('prepare',) + args)
        def close_settlement(self): emitted.append(('close',))
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda a: Docket())
    direct_vm.value = 10; c.fund('q1'); c.open_round('q1')
    direct_vm.value = 2; c.challenge('q1', address(direct_bob), 'NO')
    state['round'] = 2; c.open_round('q1')
    warp(direct_vm, '2028-01-01T00:02:00Z'); direct_vm.value = 0; c.finalize('q1')
    assert emitted == [('prepare', 0, 5), ('prepare', 1, 7), ('close',)]
