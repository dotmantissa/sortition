import json
import hashlib
from pathlib import Path
import pytest
import shutil
from functools import partial

@pytest.fixture(scope="session")
def pinned_sdk_bundle():
    from gltest.direct.sdk_loader import CACHE_DIR
    from genvm_linter.validate.artifacts import download_artifacts
    version = 'v0.3.0-rc7'
    # GenVM renamed the release bundle. The linter handles both published names;
    # direct runner 0.29.2 still requests the retired filename on a cold cache.
    artifact = download_artifacts(version)
    target = CACHE_DIR / ('genvm-universal-' + version + '.tar.xz')
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.tmp')
        shutil.copyfile(artifact, temporary)
        temporary.replace(target)
    return version


@pytest.fixture
def direct_deploy(direct_deploy, pinned_sdk_bundle):
    return partial(direct_deploy, sdk_version=pinned_sdk_bundle)


# Terms the deployed registry passes to every docket and escrow.
APPEAL_WINDOW = 60
RELAY_GRACE = 3600
HEARING_TIMEOUT = 7200
MAX_ROUNDS = 8
BODY = 'Official release. The final rate is 6 percent at the close of business.'
QUOTE = 'The final rate is 6 percent'


@pytest.fixture
def spec():
    return {'question': 'Did the published rate exceed five percent?', 'criteria': 'YES if the official rate is above 5 percent. Otherwise NO.', 'unresolvable_definition': 'No final official release or missing numeric rate.', 'sources': [{'name': 'Official A', 'url': 'https://a.example/rate'}, {'name': 'Official B', 'url': 'https://b.example/rate'}], 'tie_break_url': 'https://a.example/rate', 'disagreement_rule': 'unanimous', 'close_timestamp': 1800000000}


def deploy_docket(direct_deploy, spec, vault, relay, registry, question_id='q1', grace=RELAY_GRACE):
    canonical = json.dumps(spec, sort_keys=True, separators=(',', ':'))
    return direct_deploy('contracts/sortition_docket.py', canonical, hashlib.sha256(canonical.encode()).hexdigest(), vault, question_id, APPEAL_WINDOW, relay, registry, grace)


def vault_stub(monkeypatch, rulings=None):
    import genlayer
    class Vault:
        def emit(self, **kwargs):
            assert kwargs['on'] == 'finalized'
            return self
        def record_ruling(self, *args):
            if rulings is not None:
                rulings.append(args)
        def view(self, **kwargs): return self
        def get_account(self, key): return {'funded': True, 'settled': False, 'challenge_count': 0}
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda addr: Vault())
    return Vault


@pytest.fixture
def docket(direct_vm, direct_deploy, direct_alice, spec, monkeypatch):
    direct_vm.sender = direct_alice
    direct_vm.warp('2028-01-01T00:00:00Z')
    c = deploy_docket(direct_deploy, spec, address(direct_alice), address(direct_alice), address(direct_alice))
    c.prepare_round(0, 5)
    vault_stub(monkeypatch)
    return c


@pytest.fixture
def registry(direct_vm, direct_deploy, direct_alice, monkeypatch):
    direct_vm.sender = direct_alice
    warp(direct_vm, '2026-01-01T00:00:00Z')
    c = direct_deploy('contracts/question_registry.py', address(direct_alice), Path('contracts/sortition_docket.py').read_text(), APPEAL_WINDOW, RELAY_GRACE, HEARING_TIMEOUT, MAX_ROUNDS)
    import genlayer
    monkeypatch.setattr(genlayer.gl, 'deploy_contract', lambda **kw: direct_alice)
    class Vault:
        def emit(self, **kw): return self
        def bind(self, *a): pass
        def set_relay(self, *a): pass
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda addr: Vault())
    return c


@pytest.fixture
def vault(direct_vm, direct_deploy, direct_alice, direct_bob, monkeypatch):
    direct_vm.sender = direct_alice
    direct_vm.warp('2028-01-01T00:00:00Z')
    c = direct_deploy('contracts/settlement_vault.py', address(direct_alice))
    c.configure(address(direct_alice))
    c.bind('q1', address(direct_bob), address(direct_bob), 10, 2, APPEAL_WINDOW, 'a'*64, 1800000000, HEARING_TIMEOUT, MAX_ROUNDS)
    import genlayer
    state = {'outcome': 'YES', 'round': 1, 'deadline': 1830297660}
    class Docket:
        def view(self, **kwargs): return self
        def get_settlement(self): return state
        def emit(self, **kw): return self
        def resolve(self): pass
        def prepare_round(self, *args): state['prepared'] = args
        def close_settlement(self): state['closed'] = True
        def emit_transfer(self, **kw): state['transfer'] = kw
    monkeypatch.setattr(genlayer.gl, 'get_contract_at', lambda addr: Docket())
    # Keep the EVM transfer path distinct from GenVM contract calls.
    import sys
    class Recipient:
        def __init__(self, addr): state['recipient'] = str(addr)
        def emit_transfer(self, **kw): state['transfer'] = kw
    state['contract_module'] = sys.modules[c.__class__.__module__]
    state['recipient_interface'] = state['contract_module'].NativeRecipient
    monkeypatch.setattr(sys.modules[c.__class__.__module__], 'NativeRecipient', Recipient)
    class FinalizedMessageHarness:
        def __getattr__(self, name): return getattr(c, name)
        def open_round(self, key):
            # Deliver the real public callback with the authenticated docket sender.
            sender, value = direct_vm.sender, direct_vm.value
            direct_vm.sender, direct_vm.value = direct_bob, 0
            try: c.record_ruling(key, state['outcome'], state['round'], 'a'*64)
            finally: direct_vm.sender, direct_vm.value = sender, value
    return FinalizedMessageHarness(), state


def address(a):
    return '0x' + a.hex() if isinstance(a, bytes) else a.as_hex

def warp(vm, timestamp):
    vm.warp(timestamp)
    # genlayer-test 0.29.2 does not refresh datetime in the cached message.
    import sys
    if 'genlayer.gl' in sys.modules:
        sys.modules['genlayer.gl'].message_raw['datetime'] = timestamp


def mock_hearing(vm, position='YES', value='6 percent', quote: str | None = QUOTE, body=BODY, unresolvable=False, unsupported=None):
    """Mock one source document plus both model stages of a hearing."""
    vm.mock_web(r'https://.*\.example/rate', {'status': 200, 'body': body})
    reply = {'position': position, 'value': value}
    if quote is not None:
        reply['quote'] = quote
    vm.mock_llm(r'(?s)Extract evidence.*', json.dumps(reply))
    vm.mock_llm(r'(?s)auditing a locked prediction hearing.*', json.dumps({'unsupported_urls': unsupported or [], 'unresolvable': unresolvable}))
