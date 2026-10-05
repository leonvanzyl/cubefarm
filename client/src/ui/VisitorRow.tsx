import type { VisitorView } from '../../../shared/types';

// One visitor in the people list (VisitorsList.tsx). Their name is rendered as text, so whatever someone calls
// themselves stays text (VisitorRow.test.tsx).

export function VisitorRow({ v, where, following, onFollow }: { v: VisitorView; where: string; following: boolean; onFollow: () => void }) {
  return (
    <div className="vs-row">
      <span className="wk-dot" style={{ background: v.color }} />
      <span className="wk-main">
        <span className="wk-name">{v.name}</span>
        <span className="wk-last">{where}</span>
      </span>
      <button className={`btn btn-small vs-follow ${following ? 'vs-on' : ''}`} onClick={onFollow} title={following ? `Stop following ${v.name}` : `Follow ${v.name} with the camera`}>
        {following ? 'Stop' : '👀 Follow'}
      </button>
    </div>
  );
}
