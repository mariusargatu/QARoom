import { useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { useMembers } from '../../../hooks/useMembers'
import { ErrorState } from '../../molecules/ErrorState'
import { AddMemberForm } from '../../organisms/AddMemberForm'
import { MemberList } from '../../organisms/MemberList'

/** Page: a community's roster + role admin. */
export function MembersPage() {
  const { communityId = '' } = useParams()
  const { api } = useApi()
  const members = useMembers(api, communityId)

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-2xl font-medium text-text">Members</h1>
      {members.error ? (
        <ErrorState message={members.error} onRetry={() => void members.refresh()} />
      ) : (
        <MemberList members={members.members} loading={members.loading} />
      )}
      <section className="flex flex-col gap-4 border-t border-border pt-6">
        <h2 className="font-display text-lg font-medium text-text">Add a member</h2>
        <AddMemberForm
          pending={members.adding}
          error={members.addError}
          onSubmit={({ user_id, role }) => void members.addMember(user_id, role)}
        />
      </section>
    </div>
  )
}
