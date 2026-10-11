import Link from "next/link";
import {
  LockKeyhole,
  Scale,
  Braces,
  BookOpen,
  CircleHelp,
  ExternalLink,
  Radio,
} from "lucide-react";
import { CriteriaSeal } from "@/components/seal";
import { Explorer } from "@/components/explorer";
import { listQuestions } from "@/lib/queries";
import type { Question } from "@/lib/types";
export const dynamic = "force-dynamic";
export default async function Home() {
  let questions: Question[] = [];
  let unavailable = false;
  try {
    questions = await listQuestions();
  } catch {
    unavailable = true;
  }
  return (
    <>
      <section className="intro">
        <div className="intro-copy">
          <div className="live-tag">
            <Radio size={15} /> Independent market resolution
          </div>
          <h1>
            A question deserves
            <br />a fair hearing<span>.</span>
          </h1>
          <p className="intro-description">
            Your market has plenty of opinions.
            <br />
            Its verdict shouldn’t belong to the loudest one.
          </p>
          <div className="intro-actions">
            <Link href="/console" className="button primary">
              Register a question <LockKeyhole size={16} />
            </Link>
            <Link href="/integrate" className="text-link">
              Bring your market <Braces size={16} />
            </Link>
          </div>
        </div>
        <aside className="manifesto">
          <CriteriaSeal large />
          <p className="manifesto-title">
            Agree on the rules.
            <br />
            Before anyone wins.
          </p>
          <p>
            Sources and criteria are sealed at registration. A randomly selected
            GenLayer jury reads the evidence. Every verdict leaves a trail.
          </p>
          <a
            href="https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/optimistic-democracy"
            target="_blank"
            rel="noreferrer"
            className="quiet-link"
          >
            How the jury works <ExternalLink size={14} />
          </a>
        </aside>
      </section>
      <section className="principles" aria-label="Resolution principles">
        <div>
          <LockKeyhole size={20} />
          <p>
            <strong>Evidence, already agreed.</strong>
            <span>Two to five sources. No convenient additions.</span>
          </p>
        </div>
        <div>
          <Scale size={22} />
          <p>
            <strong>A jury you don’t get to pick.</strong>
            <span>Independent reads, checked by consensus.</span>
          </p>
        </div>
        <div>
          <CircleHelp size={21} />
          <p>
            <strong>“We can’t tell” is a verdict.</strong>
            <span>Uncertainty belongs in the open.</span>
          </p>
        </div>
      </section>
      <Explorer initial={questions} unavailable={unavailable} />
      <section className="closing-note">
        <BookOpen size={24} strokeWidth={1.4} />
        <p>
          <strong>Sortition, since ancient Athens.</strong> A jury chosen by lot
          was a simple answer to a difficult question: how do you keep someone
          from buying the verdict? We liked the question.
        </p>
        <Link className="text-link" href="/integrate">
          Read the integration guide <Braces size={16} />
        </Link>
      </section>
    </>
  );
}
