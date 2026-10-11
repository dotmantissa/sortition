from conftest import address, warp
import pytest

def funded(c, vm):
    vm.value = 10
    c.fund('q1')
    vm.value = 0

def test_fund_exact_once(vault, direct_vm):
    c, _ = vault
    direct_vm.value = 9
    with direct_vm.expect_revert('exact'):
        c.fund('q1')
    funded(c, direct_vm)
    assert c.get_account('q1')['funded']
    with direct_vm.expect_revert('exact'):
        c.fund('q1')

def test_one_time_config_and_bind_auth(vault, direct_vm, direct_bob):
    c, _ = vault
    with direct_vm.expect_revert('once'):
        c.configure(address(direct_bob))
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('Only registry'):
        c.bind('q2', address(direct_bob), address(direct_bob), 0, 1)

def test_bonds_escalate_and_winner_paid(vault, direct_vm, direct_bob):
    c, state = vault
    funded(c, direct_vm)
    direct_vm.value = 2
    c.challenge('q1', address(direct_bob), 'NO')
    assert c.get_account('q1')['challenge_count'] == 1
    state.update(round=2, outcome='NO')
    with direct_vm.expect_revert('exact escalating'):
        c.challenge('q1', address(direct_bob), 'YES')
    direct_vm.value = 4
    c.challenge('q1', address(direct_bob), 'YES')
    state.update(round=3, outcome='NO')
    warp(direct_vm, '2028-01-01T00:02:00Z')
    c.finalize('q1')
    assert c.get_credit(address(direct_bob)) == '6'
    assert c.get_account('q1')['outcome'] == 'NO'
    with direct_vm.expect_revert('expired'):
        c.finalize('q1')

def test_defender_and_fee_payout(vault, direct_vm, direct_alice, direct_bob):
    c, state = vault
    funded(c, direct_vm)
    direct_vm.value = 2
    c.challenge('q1', address(direct_bob), 'NO')
    state['round'] = 2
    warp(direct_vm, '2028-01-01T00:02:00Z')
    c.finalize('q1')
    assert c.get_credit(address(direct_bob)) == '2'
    assert c.get_credit(address(direct_alice)) == '10'
    c.withdraw(address(direct_bob))
    assert c.get_credit(address(direct_bob)) == '0'
    assert int(state['transfer']['value']) == 2
    with direct_vm.expect_revert('No credit'):
        c.withdraw(address(direct_bob))

def test_deadlines_and_same_outcome(vault, direct_vm, direct_bob):
    c, state = vault
    funded(c, direct_vm)
    with direct_vm.expect_revert('expired'):
        c.finalize('q1')
    direct_vm.value = 2
    with direct_vm.expect_revert('different'):
        c.challenge('q1', address(direct_bob), 'YES')
    warp(direct_vm, '2028-01-01T00:01:00Z')
    with direct_vm.expect_revert('No round'):
        c.challenge('q1', address(direct_bob), 'NO')

def test_no_unfunded_or_unauthorized_challenge(vault, direct_vm, direct_bob):
    c, _ = vault
    with direct_vm.expect_revert('No round'):
        c.challenge('q1', address(direct_bob), 'NO')
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('Only'):
        c.challenge('q1', address(direct_bob), 'NO')
