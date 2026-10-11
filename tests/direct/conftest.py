import json
import hashlib
from pathlib import Path
import pytest

@pytest.fixture
def spec():
    return {'question': 'Did the published rate exceed five percent?', 'criteria': 'YES if the official rate is above 5 percent. Otherwise NO.', 'unresolvable_definition': 'No final official release or missing numeric rate.', 'sources': [{'name': 'Official A', 'url': 'https://a.example/rate'}, {'name': 'Official B', 'url': 'https://b.example/rate'}], 'tie_break_url': 'https://a.example/rate', 'disagreement_rule': 'unanimous', 'close_timestamp': 1800000000}

@pytest.fixture
def docket(direct_vm, direct_deploy, direct_alice, spec, monkeypatch):
    direct_vm.sender = direct_alice
    direct_vm.warp('2028-01-01T00:00:00Z')
    canonical = json.dumps(spec, sort_keys=True, separators=(',', ':'))
    c = direct_deploy('contracts/sortition_docket.py', canonical, hashlib.sha256(canonical.encode()).hexdigest(), address(direct_alice), 'q1', 60)
    import genlayer
    class Vault:
        def view(self): return self
        def get_account(self, key): return {'funded': True, 'settled': False, 'challenge_count': 0}
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda addr: Vault())
    return c

@pytest.fixture
def registry(direct_vm, direct_deploy, direct_alice, monkeypatch):
    direct_vm.sender = direct_alice
    warp(direct_vm, '2026-01-01T00:00:00Z')
    c = direct_deploy('contracts/question_registry.py', address(direct_alice), Path('contracts/sortition_docket.py').read_text(), 60)
    import genlayer
    monkeypatch.setattr(genlayer.gl, 'deploy_contract', lambda **kw: direct_alice)
    class Vault:
        def emit(self, **kw): return self
        def bind(self, *a): pass
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda addr: Vault())
    return c

@pytest.fixture
def vault(direct_vm, direct_deploy, direct_alice, direct_bob, monkeypatch):
    direct_vm.sender = direct_alice
    direct_vm.warp('2028-01-01T00:00:00Z')
    c = direct_deploy('contracts/settlement_vault.py', address(direct_alice))
    c.configure(address(direct_alice))
    c.bind('q1', address(direct_bob), address(direct_bob), 10, 2)
    import genlayer
    state = {'outcome': 'YES', 'round': 1, 'deadline': 1830297660}
    class Docket:
        def view(self): return self
        def get_settlement(self): return state
        def emit(self, **kw): return self
        def resolve(self): pass
        def emit_transfer(self, **kw): state['transfer'] = kw
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda addr: Docket())
    # Keep the EVM transfer path distinct from GenVM contract calls.
    import sys
    class Recipient:
        def __init__(self, addr): state['recipient'] = str(addr)
        def emit_transfer(self, **kw): state['transfer'] = kw
    state['recipient_interface'] = sys.modules[c.__class__.__module__].NativeRecipient
    monkeypatch.setattr(sys.modules[c.__class__.__module__], 'NativeRecipient', Recipient)
    return c, state


def address(a):
    return '0x' + a.hex() if isinstance(a, bytes) else a.as_hex

def warp(vm, timestamp):
    vm.warp(timestamp)
    # genlayer-test 0.29.2 does not refresh datetime in the cached message.
    import sys
    if 'genlayer.gl' in sys.modules:
        sys.modules['genlayer.gl'].message_raw['datetime'] = timestamp
