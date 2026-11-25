import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="page">
      <div className="page__hero" />
      <div className="page__body">
        <div className="page__empty">
          <h2>Lost at sea</h2>
          <p>That page drifted away.</p>
          <Link className="pill pill--active" to="/">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
