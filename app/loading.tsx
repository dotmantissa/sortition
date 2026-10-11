import { LoaderCircle } from "lucide-react";
export default function Loading() {
  return (
    <div className="not-found" role="status">
      <LoaderCircle className="spinning" size={25} />
      <p>Opening the record…</p>
    </div>
  );
}
