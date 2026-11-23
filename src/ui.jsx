import { ArrowRight, FileText, Monitor } from 'lucide-react';

export function ModeChoices({ onChoose, disabled, retry = false, active = false }) {
  const options = [
    ['web', Monitor, 'Webで解く', 'すべての問題を表示し、画面上でまとめて解答します。', active ? 'Webで続ける' : 'Webで復習を始める'],
    ['paper', FileText, '紙で解く', 'PDFを印刷して解答し、全ページをカメラで取り込みます。', active ? '紙で続ける' : '印刷用の問題を作る'],
  ];
  return <div className="mode-grid">
    {options.map(([mode, Icon, title, description, label]) => <article className="mode-card" key={mode}>
      <div className="mode-intro">
        <span className="mode-icon"><Icon aria-hidden="true" /></span>
        <div><h2>{title}</h2><p>{description}</p></div>
      </div>
      <button className={mode === 'web' ? 'primary arrow-action' : 'secondary arrow-action'}
        disabled={disabled} onClick={() => onChoose(mode)}>
        {retry ? title : label}<ArrowRight size={19} aria-hidden="true" />
      </button>
    </article>)}
  </div>;
}

export function Header({ title, children, action }) {
  return <div className="heading">
    <div><h1>{title}</h1>{children && <p>{children}</p>}</div>
    {action}
  </div>;
}

export function Notice({ children }) {
  return children && <p className="notice" role="alert">{children}</p>;
}
