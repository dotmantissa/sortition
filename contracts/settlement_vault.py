# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json
from datetime import datetime


class SettlementVault(gl.Contract):
    owner: Address
    treasury: Address
    registry: Address
    configured: bool
    accounts: TreeMap[str, str]
    credits: TreeMap[Address, u256]

    def __init__(self, treasury: str):
        self.owner = gl.message.sender_address
        self.treasury = Address(treasury)
        self.configured = False

    @gl.public.write
    def configure(self, registry: str) -> None:
        if gl.message.sender_address != self.owner or self.configured:
            raise gl.vm.UserError('Registry can be configured once by owner')
        self.registry = Address(registry)
        self.configured = True

    @gl.public.write
    def bind(self, question_id: str, docket: str, beneficiary: str, fee: int, base_bond: int) -> None:
        if not self.configured or gl.message.sender_address != self.registry:
            raise gl.vm.UserError('Only registry can bind a docket')
        if question_id in self.accounts or fee < 0 or base_bond <= 0:
            raise gl.vm.UserError('Invalid escrow terms')
        self.accounts[question_id] = json.dumps({'docket': str(Address(docket)), 'beneficiary': str(Address(beneficiary)), 'fee': str(fee), 'base_bond': str(base_bond), 'funded': fee == 0, 'settled': False, 'challenge_count': 0, 'challenges': [], 'outcome': 'PENDING'})

    @gl.public.view
    def get_account(self, question_id: str) -> dict:
        if question_id not in self.accounts:
            raise gl.vm.UserError('Escrow not found')
        return json.loads(self.accounts[question_id])

    @gl.public.write.payable
    def fund(self, question_id: str) -> None:
        a = self.get_account(question_id)
        if a['funded'] or int(gl.message.value) != int(a['fee']):
            raise gl.vm.UserError('Send the exact unfunded resolution fee')
        a['funded'] = True
        self.accounts[question_id] = json.dumps(a)

    @gl.public.write.payable
    def challenge(self, question_id: str, claimant: str, expected_outcome: str) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError('Only the operator relay can sponsor a challenge')
        a = self.get_account(question_id)
        state = gl.get_contract_at(Address(a['docket'])).view().get_settlement()
        timestamp = int(datetime.fromisoformat(gl.message_raw['datetime'].replace('Z', '+00:00')).timestamp())
        required = int(a['base_bond']) * 2 ** a['challenge_count']
        if a['settled'] or not a['funded'] or state['round'] != a['challenge_count'] + 1 or timestamp >= state['deadline']:
            raise gl.vm.UserError('No round is open for challenge')
        if expected_outcome not in ('YES', 'NO', 'UNRESOLVABLE') or expected_outcome == state['outcome']:
            raise gl.vm.UserError('Challenge must name a different outcome')
        if int(gl.message.value) != required:
            raise gl.vm.UserError('Send the exact escalating bond')
        # Bounds prevent unbounded settlement loops and integer overflow.
        if a['challenge_count'] >= 32:
            raise gl.vm.UserError('Maximum bonded rounds reached; use protocol appeal')
        a['challenges'].append({'claimant': str(Address(claimant)), 'expected': expected_outcome, 'bond': str(required), 'round': state['round']})
        a['challenge_count'] += 1
        self.accounts[question_id] = json.dumps(a)
        # The relay observes this finalized bond and requests a larger random panel.
        # Resolution can also be retried permissionlessly if the relay is unavailable.

    @gl.public.write
    def finalize(self, question_id: str) -> None:
        a = self.get_account(question_id)
        state = gl.get_contract_at(Address(a['docket'])).view().get_settlement()
        timestamp = int(datetime.fromisoformat(gl.message_raw['datetime'].replace('Z', '+00:00')).timestamp())
        if a['settled'] or not a['funded'] or state['round'] != a['challenge_count'] + 1 or timestamp < state['deadline']:
            raise gl.vm.UserError('A completed round and expired appeal window are required')
        winners = [c for c in a['challenges'] if c['expected'] == state['outcome']]
        pool = sum(int(c['bond']) for c in a['challenges'])
        # Return winning bonds and divide losing bonds by winning bonded stake.
        winning_stake = sum(int(c['bond']) for c in winners)
        allocated = 0
        for c in winners:
            share = pool * int(c['bond']) // winning_stake
            allocated += share
            addr = Address(c['claimant'])
            self.credits[addr] = self.credits.get(addr, u256(0)) + u256(share)
        beneficiary = Address(a['beneficiary'])
        self.credits[beneficiary] = self.credits.get(beneficiary, u256(0)) + u256(pool - allocated)
        self.credits[self.treasury] = self.credits.get(self.treasury, u256(0)) + u256(int(a['fee']))
        a.update(settled=True, outcome=state['outcome'], final_round=state['round'])
        self.accounts[question_id] = json.dumps(a)

    @gl.public.write
    def withdraw(self, beneficiary: str) -> None:
        addr = Address(beneficiary)
        if gl.message.sender_address not in (addr, self.owner):
            raise gl.vm.UserError('Only beneficiary or relay can withdraw')
        amount = self.credits.get(addr, u256(0))
        if amount == 0:
            raise gl.vm.UserError('No credit to withdraw')
        self.credits[addr] = u256(0)
        # Studio supports native transfers through its balance ledger.
        gl.get_contract_at(addr).emit_transfer(value=amount, on='finalized')

    @gl.public.view
    def get_credit(self, beneficiary: str) -> str:
        return str(self.credits.get(Address(beneficiary), u256(0)))
