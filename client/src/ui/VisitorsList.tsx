import type { RepoView } from '../../../shared/types';
import { useStore } from '../store';
import { useCameraView } from '../world/camera/rig';
import { followVisitor, following, stopFollowing } from '../world/presence/presenceState';
import { useProfile } from '../world/presence/profile';
import { VisitorRow } from './VisitorRow';

// Who else is in the office (shared presence), at the top of the people list: where each visitor is, and Follow to
// trail them with the camera.

const floorName = (repos: RepoView[], floor: number) => (floor === 0 ? 'Lobby' : `Floor ${floor} · ${repos.find((r) => r.floor === floor)?.fullName.split('/')[1] ?? ''}`);

export function VisitorsList() {
  const visitors = useStore((s) => s.visitors);
  const repos = useStore((s) => s.repos);
  const floor = useStore((s) => s.floor);
  const followingId = useCameraView((s) => (s.mode === 'follow' ? following() : null));
  const { name, appear } = useProfile();
  if (!visitors.length) return null;
  // the ones on your floor first
  const list = [...visitors].sort((a, b) => Number(b.floor === floor) - Number(a.floor === floor));
  return (
    <div className="wk-group">
      <div className="wk-group-head vs-head" title="Everyone else viewing the office">
        <span className="wk-group-arrow">👋</span>
        <span className="wk-group-name">Visitors</span>
        <span className="vs-me">{appear ? `you: ${name}` : 'you: hidden'}</span>
        <span className="wk-group-count">{visitors.length}</span>
      </div>
      {list.map((v) => (
        <VisitorRow
          key={v.id}
          v={v}
          where={v.floor === floor ? 'here' : floorName(repos, v.floor)}
          following={followingId === v.id}
          onFollow={() => (followingId === v.id ? stopFollowing() : followVisitor(v.id))}
        />
      ))}
    </div>
  );
}
