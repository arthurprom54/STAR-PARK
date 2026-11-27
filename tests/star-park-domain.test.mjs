import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationWasApproved, memberAccountEligible, accountRoles } from '../lib/star-park-domain.mjs';

const approvedApplication = {
  id: 'app-1', playerTag: '#ABC123', status: 'ACTIVE',
  history: [{ status: 'PENDING' }, { status: 'IN_REVIEW' }, { status: 'APPROVED' }, { status: 'AWAITING_WHATSAPP' }],
};
const activeMember = { id: 'mem-1', applicationId: 'app-1', playerTag: 'ABC123', status: 'ACTIVE' };

test('somente histórico com aprovação explícita conta como candidatura aprovada', () => {
  assert.equal(applicationWasApproved(approvedApplication), true);
  assert.equal(applicationWasApproved({ status: 'AWAITING_WHATSAPP', history: [{ status: 'PENDING' }] }), false);
  assert.equal(applicationWasApproved({ status: 'ACTIVE', history: [{ status: 'ACTIVE' }] }), false);
  assert.equal(applicationWasApproved({ status: 'REJECTED', history: [{ status: 'APPROVED' }, { status: 'REJECTED' }] }), false);
});

test('solicitação de conta exige membro ativo, candidatura vinculada e aprovada', () => {
  assert.equal(memberAccountEligible(activeMember, [approvedApplication]), true);
  assert.equal(memberAccountEligible({ ...activeMember, status: 'SUSPENDED' }, [approvedApplication]), false);
  assert.equal(memberAccountEligible({ ...activeMember, applicationId: null }, [approvedApplication]), false);
  assert.equal(memberAccountEligible(activeMember, [{ ...approvedApplication, history: [{ status: 'PENDING' }] }]), false);
  assert.equal(memberAccountEligible(activeMember, [{ ...approvedApplication, status: 'AWAITING_WHATSAPP' }]), false);
  assert.equal(memberAccountEligible(activeMember, [{ ...approvedApplication, status: 'REJECTED' }]), false);
});

test('correção de tag não rompe o vínculo com a candidatura original', () => {
  const corrected = { ...activeMember, playerTag: 'NEW999', previousPlayerTags: ['ABC123'] };
  assert.equal(memberAccountEligible(corrected, [approvedApplication]), true);
  assert.equal(memberAccountEligible({ ...corrected, previousPlayerTags: [] }, [approvedApplication]), false);
});

test('uma conta administrativa vinculada recebe também o papel de membro', () => {
  assert.deepEqual(accountRoles({ role: 'ADMIN', memberId: 'mem-1' }), ['ADMIN', 'MEMBER']);
  assert.deepEqual(accountRoles({ role: 'MEMBER', memberId: 'mem-1' }), ['MEMBER']);
  assert.deepEqual(accountRoles({ role: 'OWNER' }), ['OWNER']);
});
