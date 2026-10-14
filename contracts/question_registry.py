# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json
import hashlib
from datetime import datetime


class QuestionRegistry(gl.Contract):
    owner: Address
    vault: Address
    docket_code: str
    questions: TreeMap[str, str]
    question_ids: DynArray[str]
    appeal_window: u256
    relay_grace: u256
    hearing_timeout: u256
    max_rounds: u256

    def __init__(self, vault: str, docket_code: str, appeal_window: int, relay_grace: int, hearing_timeout: int, max_rounds: int):
        if appeal_window < 60 or appeal_window > 604800:
            raise gl.vm.UserError('Invalid appeal window')
        if not 60 <= relay_grace <= 2592000:
            raise gl.vm.UserError('Invalid relay grace period')
        if not 300 <= hearing_timeout <= 2592000 or hearing_timeout <= appeal_window:
            raise gl.vm.UserError('Invalid hearing timeout')
        if not 1 <= max_rounds <= 8:
            raise gl.vm.UserError('Invalid bonded round limit')
        self.owner = gl.message.sender_address
        self.vault = Address(vault)
        self.docket_code = docket_code
        self.appeal_window = u256(appeal_window)
        self.relay_grace = u256(relay_grace)
        self.hearing_timeout = u256(hearing_timeout)
        self.max_rounds = u256(max_rounds)

    @gl.public.view
    def get_terms(self) -> dict:
        return {'version': 5, 'relay': str(self.owner), 'vault': str(self.vault), 'appeal_window': int(self.appeal_window), 'relay_grace': int(self.relay_grace), 'hearing_timeout': int(self.hearing_timeout), 'max_rounds': int(self.max_rounds), 'docket_code_hash': hashlib.sha256(self.docket_code.encode()).hexdigest()}

    @gl.public.write
    def transfer_relay(self, relay: str) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError('Only the current relay can hand over its role')
        self.owner = Address(relay)

    @gl.public.write
    def rotate_relay(self, question_id: str, relay: str) -> None:
        # A docket's requesting relay can be replaced without touching its
        # locked specification, stored rulings or escrow.
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError('Only the operator relay can rotate a docket relay')
        if question_id not in self.questions:
            raise gl.vm.UserError('Question not found')
        q = json.loads(self.questions[question_id])
        gl.get_contract_at(Address(q['docket_address'])).emit(on='finalized').set_relay(relay)

    @gl.public.write
    def register(self, question_id: str, specification: str, beneficiary: str, fee: int, base_bond: int) -> str:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError('Only the operator relay can register')
        if question_id in self.questions or not question_id or len(question_id) > 80:
            raise gl.vm.UserError('Invalid or duplicate question ID')
        spec = json.loads(specification)
        for key in ('question', 'criteria', 'unresolvable_definition'):
            if not isinstance(spec.get(key), str) or not 10 <= len(spec[key]) <= 10000:
                raise gl.vm.UserError('Question, criteria and unresolvable definition are required')
        sources = spec.get('sources', [])
        if not 2 <= len(sources) <= 5:
            raise gl.vm.UserError('Register two to five sources')
        urls = []
        for s in sources:
            if not isinstance(s.get('name'), str) or not s['name'].strip() or not isinstance(s.get('url'), str) or not s['url'].startswith('https://') or len(s['url']) > 2048:
                raise gl.vm.UserError('Sources require a name and HTTPS URL')
            urls.append(s['url'])
        if len(set(urls)) != len(urls) or spec.get('tie_break_url') not in urls:
            raise gl.vm.UserError('Tie break must be a unique registered source')
        if spec.get('disagreement_rule') not in ('unanimous', 'majority', 'tie_break'):
            raise gl.vm.UserError('Unknown disagreement rule')
        current = int(datetime.fromisoformat(gl.message_raw['datetime'].replace('Z', '+00:00')).timestamp())
        if not isinstance(spec.get('close_timestamp'), int) or spec['close_timestamp'] <= current:
            raise gl.vm.UserError('Closing time must be in the future')
        # These three clocks are locked independently. Older callers explicitly
        # inherit close as their observation/resolution time at registration.
        spec.setdefault('observation_timestamp', spec['close_timestamp'])
        spec.setdefault('resolution_timestamp', spec['observation_timestamp'])
        spec.setdefault('evidence_mode', 'event_outcome')
        observation, resolution = spec['observation_timestamp'], spec['resolution_timestamp']
        if type(observation) is not int or type(resolution) is not int or observation < spec['close_timestamp'] or resolution < observation:
            raise gl.vm.UserError('Trading close, observation and resolution times must be ordered')
        if spec['evidence_mode'] not in ('event_outcome', 'historical_state'):
            raise gl.vm.UserError('Unknown temporal evidence mode')
        if spec['evidence_mode'] == 'historical_state':
            for source in sources:
                digest = source.get('content_sha256', '')
                if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
                    raise gl.vm.UserError('Historical state requires locked source snapshot hashes')
        if fee < 0 or base_bond <= 0 or base_bond > 10 ** 30:
            raise gl.vm.UserError('Invalid fee or bond')
        # Hash the complete canonical payload, including any operator metadata.
        canonical = json.dumps(spec, sort_keys=True, separators=(',', ':'))
        criteria_hash = hashlib.sha256(canonical.encode()).hexdigest()
        addr = gl.deploy_contract(code=self.docket_code.encode(), args=[canonical, criteria_hash, str(self.vault), question_id, int(self.appeal_window), str(self.owner), str(gl.message.contract_address), int(self.relay_grace)], salt_nonce=u256(len(self.question_ids) + 1), on='finalized')
        self.questions[question_id] = json.dumps({'version': 5, 'id': question_id, 'docket_address': str(addr), 'criteria_hash': criteria_hash, 'specification': spec, 'beneficiary': str(Address(beneficiary)), 'fee': str(fee), 'base_bond': str(base_bond), 'relay_grace': int(self.relay_grace), 'hearing_timeout': int(self.hearing_timeout), 'max_rounds': int(self.max_rounds)})
        self.question_ids.append(question_id)
        gl.get_contract_at(self.vault).emit(on='finalized').bind(question_id, str(addr), beneficiary, fee, base_bond, int(self.appeal_window), criteria_hash, int(spec['resolution_timestamp']), int(self.hearing_timeout), int(self.max_rounds))
        return criteria_hash

    @gl.public.view
    def get_question(self, question_id: str) -> dict:
        if question_id not in self.questions:
            raise gl.vm.UserError('Question not found')
        return json.loads(self.questions[question_id])

    @gl.public.view
    def list_questions(self, offset: int, limit: int) -> dict:
        if offset < 0 or limit < 1 or limit > 100:
            raise gl.vm.UserError('Invalid pagination')
        return {'total': len(self.question_ids), 'questions': [json.loads(self.questions[self.question_ids[i]]) for i in range(offset, min(offset + limit, len(self.question_ids)))]}
