import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="OutreachIt home">
      <span className="brand-icon">
        <Mail size={21} />
      </span>
      outreach<span>it</span>
      <span className="brand-period">.</span>
    </Link>
  );
}
