from conftest import address, warp, APPEAL_WINDOW, RELAY_GRACE, HEARING_TIMEOUT, MAX_ROUNDS
import json
import hashlib
import pytest

def test_locked_hash_and_listing(registry, spec, direct_alice):
    h = registry.register('q1', json.dumps(spec), address(direct_alice), 0, 1)
    assert h == hashlib.sha256(json.dumps(spec, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    assert registry.get_question('q1')['specification'] == spec
    assert registry.list_questions(0, 10)['total'] == 1
    assert registry.list_questions(1, 10)['questions'] == []

def test_duplicate(registry, spec, direct_alice, direct_vm):
    registry.register('q1', json.dumps(spec), address(direct_alice), 0, 1)
    with direct_vm.expect_revert('duplicate'):
        registry.register('q1', json.dumps(spec), address(direct_alice), 0, 1)

@pytest.mark.parametrize('change,message', [({'sources': []}, 'two to five'), ({'tie_break_url': 'https://other.example'}, 'Tie break'), ({'disagreement_rule': 'whatever'}, 'Unknown'), ({'question': ''}, 'required'), ({'close_timestamp': 0}, 'future')])
def test_invalid_spec(registry, spec, direct_alice, direct_vm, change, message):
    spec.update(change)
    with direct_vm.expect_revert(message):
        registry.register('q1', json.dumps(spec), address(direct_alice), 0, 1)

def test_source_validation(registry, spec, direct_alice, direct_vm):
    spec['sources'][1]['url'] = spec['sources'][0]['url']
    with direct_vm.expect_revert('unique'):
        registry.register('q1', json.dumps(spec), address(direct_alice), 0, 1)
    spec['sources'][1]['url'] = 'http://unsafe.example'
    with direct_vm.expect_revert('HTTPS'):
        registry.register('q1', json.dumps(spec), address(direct_alice), 0, 1)

def test_access_and_pagination(registry, spec, direct_bob, direct_vm):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('Only'):
        registry.register('q1', json.dumps(spec), address(direct_bob), 0, 1)
    with direct_vm.expect_revert('pagination'):
        registry.list_questions(-1, 10)
    with direct_vm.expect_revert('not found'):
        registry.get_question('absent')

@pytest.mark.parametrize('fee,bond', [(-1,1),(0,0),(0,-1),(0,10**31)])
def test_bad_escrow_terms(registry,spec,direct_alice,direct_vm,fee,bond):
    with direct_vm.expect_revert('Invalid fee'):
        registry.register('q1',json.dumps(spec),address(direct_alice),fee,bond)

def test_source_count_bound(registry,spec,direct_alice,direct_vm):
    spec['sources']=[{'name':str(i),'url':f'https://{i}.example/result'} for i in range(6)]
    with direct_vm.expect_revert('two to five'):
        registry.register('q1',json.dumps(spec),address(direct_alice),0,1)

@pytest.mark.parametrize('window,grace,timeout,rounds,message', [
    (59, RELAY_GRACE, HEARING_TIMEOUT, MAX_ROUNDS, 'appeal window'),
    (APPEAL_WINDOW, 59, HEARING_TIMEOUT, MAX_ROUNDS, 'relay grace'),
    (APPEAL_WINDOW, RELAY_GRACE, 299, MAX_ROUNDS, 'hearing timeout'),
    (APPEAL_WINDOW, RELAY_GRACE, APPEAL_WINDOW, MAX_ROUNDS, 'hearing timeout'),
    (APPEAL_WINDOW, RELAY_GRACE, HEARING_TIMEOUT, 0, 'bonded round limit'),
    (APPEAL_WINDOW, RELAY_GRACE, HEARING_TIMEOUT, 9, 'bonded round limit'),
])
def test_registered_terms_must_be_bounded(direct_vm,direct_deploy,direct_alice,window,grace,timeout,rounds,message):
    direct_vm.sender=direct_alice
    with direct_vm.expect_revert(message):
        direct_deploy('contracts/question_registry.py',address(direct_alice),'code',window,grace,timeout,rounds)


def test_published_terms_describe_the_bounded_lifecycle(registry, direct_alice):
    terms = registry.get_terms()
    assert terms['appeal_window'] == APPEAL_WINDOW
    assert terms['relay_grace'] == RELAY_GRACE
    assert terms['hearing_timeout'] == HEARING_TIMEOUT
    assert terms['max_rounds'] == MAX_ROUNDS
    assert terms['relay'].lower() == address(direct_alice).lower()
    assert len(terms['docket_code_hash']) == 64


def test_relay_role_and_docket_relay_can_be_rotated(registry, spec, direct_alice, direct_bob, direct_vm, monkeypatch):
    import genlayer
    monkeypatch.setattr(genlayer.gl, 'deploy_contract', lambda **kw: genlayer.Address(address(direct_bob)))
    registry.register('q1', json.dumps(spec), address(direct_alice), 0, 1)
    rotations = []
    class Docket:
        def emit(self, **kw):
            assert kw['on'] == 'finalized'
            return self
        def set_relay(self, relay): rotations.append(relay)
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda a: Docket())
    with direct_vm.expect_revert('not found'):
        registry.rotate_relay('absent', address(direct_bob))
    registry.rotate_relay('q1', address(direct_bob))
    assert rotations == [address(direct_bob)]
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert('operator relay'):
        registry.rotate_relay('q1', address(direct_bob))
    with direct_vm.expect_revert('current relay'):
        registry.transfer_relay(address(direct_bob))
    direct_vm.sender = direct_alice
    registry.transfer_relay(address(direct_bob))
    assert registry.get_terms()['relay'].lower() == address(direct_bob).lower()
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert('Only the operator relay'):
        registry.register('q2', json.dumps(spec), address(direct_alice), 0, 1)

def test_factory_binds_the_locked_docket_with_distinct_salts(registry, spec, direct_alice, direct_bob, monkeypatch):
    import genlayer
    deployments,bindings=[],[]
    def deploy(**kwargs):
        deployments.append(kwargs)
        return direct_bob
    class Vault:
        def emit(self, **kwargs):
            assert kwargs['on']=='finalized'
            return self
        def bind(self,*args):bindings.append(args)
    monkeypatch.setattr(genlayer.gl,'deploy_contract',deploy)
    monkeypatch.setattr(genlayer.gl,'get_contract_at',lambda addr:Vault())
    for key in ['first','second']:
        fingerprint=registry.register(key,json.dumps(spec),address(direct_alice),10,2)
        args=deployments[-1]['args']
        assert json.loads(args[0])==spec
        assert args[1]==fingerprint
        assert args[3]==key
        assert args[5].lower()==address(direct_alice).lower()
        # The docket also learns its registry and the relay grace period, so a
        # lost relay key can be rotated and can never strand the docket.
        assert isinstance(args[6],str) and args[6].startswith('0x') and len(args[6])==42
        assert args[7]==RELAY_GRACE
        assert isinstance(deployments[-1]['code'],bytes)
        # Every escrow is bound with the closing time, the hearing deadline and
        # the bonded round limit, so locked value always has an exit.
        assert bindings[-1]==(key,str(genlayer.Address(address(direct_bob))),address(direct_alice),10,2,APPEAL_WINDOW,fingerprint,spec['close_timestamp'],HEARING_TIMEOUT,MAX_ROUNDS)
    assert int(deployments[0]['salt_nonce'])!=int(deployments[1]['salt_nonce'])
