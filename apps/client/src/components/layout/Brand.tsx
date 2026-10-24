import { Mail } from 'lucide-react';
import { Link } from 'react-router';

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Outreacher home">
      <span className="brand-icon">
        <Mail size={21} />
      </span>
      outreach<span>er</span>
      <span className="brand-period">.</span>
    </Link>
  );
}
