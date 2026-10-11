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
    assert state['recipient'].lower() == address(direct_bob).lower()
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

def test_pending_challenge_blocks_finalization(vault,direct_vm,direct_bob):
    c,state=vault
    funded(c,direct_vm)
    direct_vm.value=2
    c.challenge('q1',address(direct_bob),'NO')
    warp(direct_vm,'2028-01-01T00:02:00Z')
    with direct_vm.expect_revert('completed round'):
        c.finalize('q1')

def test_unauthorized_withdraw(vault,direct_vm,direct_charlie,direct_bob):
    c,_=vault
    direct_vm.sender=direct_charlie
    with direct_vm.expect_revert('Only beneficiary'):
        c.withdraw(address(direct_bob))

def test_zero_fee_binding_is_funded(vault,direct_vm,direct_alice,direct_bob):
    c,_=vault
    c.bind('q2',address(direct_bob),address(direct_bob),0,1)
    assert c.get_account('q2')['funded']
    with direct_vm.expect_revert('Invalid escrow'):
        c.bind('q2',address(direct_bob),address(direct_bob),0,1)
    with direct_vm.expect_revert('not found'):
        c.get_account('missing')

def test_multiple_winners_share_pool_and_dust_without_losing_value(vault,direct_vm,direct_alice,direct_bob,direct_charlie):
    c,state=vault
    funded(c,direct_vm)
    direct_vm.value=2
    c.challenge('q1',address(direct_bob),'NO')
    state.update(round=2,outcome='NO')
    direct_vm.value=4
    c.challenge('q1',address(direct_alice),'YES')
    state.update(round=3,outcome='YES')
    direct_vm.value=8
    c.challenge('q1',address(direct_charlie),'NO')
    state.update(round=4,outcome='NO')
    warp(direct_vm,'2028-01-01T00:02:00Z')
    c.finalize('q1')
    assert c.get_credit(address(direct_bob))=='3'
    assert c.get_credit(address(direct_charlie))=='11'
    assert c.get_credit(address(direct_alice))=='10'
    assert sum(int(c.get_credit(address(a))) for a in [direct_alice,direct_bob,direct_charlie])==24


def test_native_withdraw_emits_evm_payment_instead_of_genvm_call(vault,direct_vm,direct_bob,monkeypatch):
    import sys
    import genlayer.gl._internal.gl_call as calls
    c,state=vault
    funded(c,direct_vm)
    direct_vm.value=2
    c.challenge('q1',address(direct_bob),'NO')
    state['round']=2
    warp(direct_vm,'2028-01-01T00:02:00Z')
    c.finalize('q1')
    emitted=[]
    class Completed:
        def get(self): return None
    def capture(message, decoder):
        emitted.append(message)
        return Completed()
    monkeypatch.setattr(sys.modules[c.__class__.__module__],'NativeRecipient',state['recipient_interface'])
    monkeypatch.setattr(calls,'gl_call_generic',capture)
    c.withdraw(address(direct_bob))
    assert len(emitted)==1
    transfer=emitted[0]['EthSend']
    assert str(transfer['address']).lower()==address(direct_bob).lower()
    assert transfer['calldata']==b''
    assert int(transfer['value'])==2
    assert c.get_credit(address(direct_bob))=='0'
