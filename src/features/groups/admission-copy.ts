import type { TFunction } from 'i18next';
import type { GroupAdmissionDetail } from '@/services/api/group-admissions';

export function getGroupAdmissionRelationship(
  admission: GroupAdmissionDetail,
  viewerId: string | undefined,
  t: TFunction,
) {
  if (admission.kind !== 'INVITE')
    return t('groupAdmission.applicant', { name: admission.applicantName });
  if (admission.isApplicant || admission.applicantId === viewerId)
    return t('groupAdmission.invitedBy', { name: admission.inviterName });
  if (admission.inviterId === viewerId)
    return t('groupAdmission.invitedByYou', { name: admission.applicantName });
  return t('groupAdmission.invitedPerson', {
    inviter: admission.inviterName,
    applicant: admission.applicantName,
  });
}

export function getGroupAdmissionStatus(
  admission: GroupAdmissionDetail,
  viewerId: string | undefined,
  t: TFunction,
) {
  const status = t(`groupAdmission.status.${admission.status}`);
  return admission.isApplicant || admission.applicantId === viewerId
    ? status
    : t('groupAdmission.personStatus', { name: admission.applicantName, status });
}
