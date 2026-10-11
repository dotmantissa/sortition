import Link from "next/link";
export default function NotFound() {
  return (
    <div className="not-found">
      <h1>This question isn’t in the record.</h1>
      <p>
        The link may have wandered off. The public docket is a good place to
        start.
      </p>
      <Link href="/" className="button primary">
        Back to the docket
      </Link>
    </div>
  );
}
