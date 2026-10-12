from conftest import address, warp, HEARING_TIMEOUT, MAX_ROUNDS, APPEAL_WINDOW
import pytest

# The vault fixture binds q1 with close_timestamp 1800000000 while the clock is
# at 2028-01-01T00:00:00Z, so a funded hearing is due 2 hours after funding.
FUNDED_DEADLINE = '2028-01-01T02:00:01Z'

def funded(c, vm):
    vm.value = 10
    c.fund('q1')
    vm.value = 0
    c.open_round('q1')

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
        c.bind('q2', address(direct_bob), address(direct_bob), 0, 1, APPEAL_WINDOW, 'a'*64, 1800000000, HEARING_TIMEOUT, MAX_ROUNDS)

@pytest.mark.parametrize('close,timeout,rounds', [(0, HEARING_TIMEOUT, 1), (1800000000, 299, 1), (1800000000, HEARING_TIMEOUT, 0), (1800000000, HEARING_TIMEOUT, 9)])
def test_bind_rejects_unbounded_hearing_terms(vault, direct_vm, direct_bob, close, timeout, rounds):
    c, _ = vault
    with direct_vm.expect_revert('hearing deadline terms'):
        c.bind('q2', address(direct_bob), address(direct_bob), 0, 1, APPEAL_WINDOW, 'a'*64, close, timeout, rounds)

def test_bonds_escalate_and_winner_paid(vault, direct_vm, direct_bob):
    c, state = vault
    funded(c, direct_vm)
    direct_vm.value = 2
    direct_vm.sender = direct_bob
    c.challenge('q1', address(direct_bob), 'NO')
    assert c.get_account('q1')['challenge_count'] == 1
    state.update(round=2, outcome='NO')
    c.open_round('q1')
    with direct_vm.expect_revert('exact escalating'):
        c.challenge('q1', address(direct_bob), 'YES')
    direct_vm.value = 4
    c.challenge('q1', address(direct_bob), 'YES')
    state.update(round=3, outcome='NO')
    c.open_round('q1')
    warp(direct_vm, '2028-01-01T00:02:00Z')
    c.finalize('q1')
    assert c.get_credit(address(direct_bob)) == '6'
    assert c.get_account('q1')['outcome'] == 'NO'
    with direct_vm.expect_revert('expired'):
        c.finalize('q1')

def test_losing_sponsored_bond_never_pays_question_beneficiary(vault, direct_vm, direct_alice, direct_bob):
    c, state = vault
    funded(c, direct_vm)
    direct_vm.value = 2
    c.challenge('q1', address(direct_bob), 'NO')
    state['round'] = 2
    c.open_round('q1')
    warp(direct_vm, '2028-01-01T00:02:00Z')
    c.finalize('q1')
    assert c.get_credit(address(direct_bob)) == '0'
    assert c.get_credit(address(direct_alice)) == '12'
    c.withdraw(address(direct_alice))
    assert c.get_credit(address(direct_alice)) == '0'
    assert int(state['transfer']['value']) == 12
    assert state['recipient'].lower() == address(direct_alice).lower()
    with direct_vm.expect_revert('No credit'):
        c.withdraw(address(direct_alice))

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

def test_no_unfunded_or_unauthorized_challenge(vault, direct_vm, direct_bob, direct_alice):
    c, _ = vault
    with direct_vm.expect_revert('No round'):
        c.challenge('q1', address(direct_bob), 'NO')
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('Only'):
        c.challenge('q1', address(direct_alice), 'NO')

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
    c.bind('q2',address(direct_bob),address(direct_bob),0,1,APPEAL_WINDOW,'a'*64,1800000000,HEARING_TIMEOUT,MAX_ROUNDS)
    account = c.get_account('q2')
    assert account['funded']
    # A zero fee hearing is still bounded from the moment it becomes payable.
    assert account['hearing_deadline'] == 1830297600 + HEARING_TIMEOUT
    assert account['fee_payer'] == ''
    with direct_vm.expect_revert('Invalid escrow'):
        c.bind('q2',address(direct_bob),address(direct_bob),0,1,APPEAL_WINDOW,'a'*64,1800000000,HEARING_TIMEOUT,MAX_ROUNDS)
    with direct_vm.expect_revert('not found'):
        c.get_account('missing')

def test_multiple_winners_share_pool_and_dust_without_losing_value(vault,direct_vm,direct_alice,direct_bob,direct_charlie):
    c,state=vault
    funded(c,direct_vm)
    direct_vm.value=2
    direct_vm.sender=direct_bob
    c.challenge('q1',address(direct_bob),'NO')
    direct_vm.sender=direct_alice
    state.update(round=2,outcome='NO')
    c.open_round('q1')
    direct_vm.value=4
    c.challenge('q1',address(direct_alice),'YES')
    state.update(round=3,outcome='YES')
    c.open_round('q1')
    direct_vm.value=8
    direct_vm.sender=direct_charlie
    c.challenge('q1',address(direct_charlie),'NO')
    state.update(round=4,outcome='NO')
    c.open_round('q1')
    warp(direct_vm,'2028-01-01T00:02:00Z')
    c.finalize('q1')
    assert c.get_credit(address(direct_bob))=='2'
    assert c.get_credit(address(direct_charlie))=='11'
    assert c.get_credit(address(direct_alice))=='11'
    assert sum(int(c.get_credit(address(a))) for a in [direct_alice,direct_bob,direct_charlie])==24


def test_native_withdraw_emits_evm_payment_instead_of_genvm_call(vault,direct_vm,direct_bob,direct_alice,monkeypatch):
    import sys
    import genlayer.gl._internal.gl_call as calls
    c,state=vault
    funded(c,direct_vm)
    direct_vm.value=2
    c.challenge('q1',address(direct_bob),'NO')
    state['round']=2
    c.open_round('q1')
    warp(direct_vm,'2028-01-01T00:02:00Z')
    c.finalize('q1')
    emitted=[]
    class Completed:
        def get(self): return None
    def capture(message, decoder):
        emitted.append(message)
        return Completed()
    monkeypatch.setattr(state['contract_module'],'NativeRecipient',state['recipient_interface'])
    monkeypatch.setattr(calls,'gl_call_generic',capture)
    c.withdraw(address(direct_alice))
    assert len(emitted)==1
    transfer=emitted[0]['EthSend']
    assert str(transfer['address']).lower()==address(direct_alice).lower()
    assert transfer['calldata']==b''
    assert int(transfer['value'])==12
    assert c.get_credit(address(direct_bob))=='0'


def test_bonded_rounds_are_bounded_by_the_registered_limit(direct_vm,direct_deploy,direct_alice,direct_bob,monkeypatch):
    direct_vm.sender=direct_alice
    direct_vm.warp('2028-01-01T00:00:00Z')
    c=direct_deploy('contracts/settlement_vault.py',address(direct_alice))
    c.configure(address(direct_alice))
    # One bonded round only, so the escalating panel stays inside the range
    # this deployment can actually seat.
    c.bind('q1',address(direct_bob),address(direct_bob),0,1,APPEAL_WINDOW,'a'*64,1800000000,HEARING_TIMEOUT,1)
    import genlayer
    prepared=[]
    class Docket:
        def emit(self,**kw):return self
        def prepare_round(self,*args):prepared.append(args)
        def close_settlement(self):pass
    monkeypatch.setattr(genlayer.gl,'get_contract_at',lambda a:Docket())
    direct_vm.sender=direct_bob
    c.record_ruling('q1','YES',1,'a'*64)
    direct_vm.sender=direct_alice
    direct_vm.value=1
    c.challenge('q1',address(direct_alice),'NO')
    assert prepared[-1]==(1,7)
    direct_vm.sender=direct_bob
    direct_vm.value=0
    c.record_ruling('q1','NO',2,'a'*64)
    direct_vm.sender=direct_alice
    direct_vm.value=2
    with direct_vm.expect_revert('Maximum bonded rounds'):
        c.challenge('q1',address(direct_alice),'YES')


def test_each_funded_round_commits_its_required_panel(vault,direct_vm,direct_bob):
    c,state=vault
    funded(c,direct_vm)
    assert state['prepared']==(0,5)
    assert c.get_account('q1')['required_validators']==5
    direct_vm.value=2
    c.challenge('q1',address(direct_bob),'NO')
    assert state['prepared']==(1,7)
    assert c.get_account('q1')['required_validators']==7
    assert c.get_configuration()['minimum_panel']==5


def test_relay_role_can_be_handed_over(vault,direct_vm,direct_alice,direct_bob,direct_charlie):
    c,_=vault
    assert c.get_configuration()['relay'].lower()==address(direct_alice).lower()
    direct_vm.sender=direct_charlie
    with direct_vm.expect_revert('current relay'):
        c.transfer_relay(address(direct_charlie))
    direct_vm.sender=direct_alice
    c.transfer_relay(address(direct_charlie))
    assert c.get_configuration()['relay'].lower()==address(direct_charlie).lower()
    # The retired key can no longer sponsor a bond on someone else's behalf.
    direct_vm.value=2
    with direct_vm.expect_revert('Only claimant'):
        c.challenge('q1',address(direct_bob),'NO')
