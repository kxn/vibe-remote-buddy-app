import { Github } from "lucide-react";
import { call, native } from "./native";

export const project = {
  github: "https://github.com/kxn/vibe-remote-buddy-app",
  bilibili: "https://space.bilibili.com/343648047",
  notices:
    "https://github.com/kxn/vibe-remote-buddy-app/blob/main/THIRD_PARTY_NOTICES.md",
};
export function ExternalLink({
  href,
  children,
  label,
  onError,
}: {
  href: string;
  children: React.ReactNode;
  label?: string;
  onError: (e: unknown) => void;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      onClick={(e) => {
        if (native) {
          e.preventDefault();
          void call("run_action", { kind: "web", target: href }).catch(onError);
        }
      }}
    >
      {children}
    </a>
  );
}
function BilibiliIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m7 2 3 4m7-4-3 4" />
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <path d="m7 11 2 1m8-1-2 1m-6 4 3 1 3-1M7 20v2m10-2v2" />
    </svg>
  );
}
export function ProjectLinks({ onError }: { onError: (e: unknown) => void }) {
  return (
    <nav className="project-links" aria-label="项目链接">
      <ExternalLink href={project.github} label="GitHub" onError={onError}>
        <Github size={19} aria-hidden="true" />
      </ExternalLink>
      <ExternalLink href={project.bilibili} label="B 站" onError={onError}>
        <BilibiliIcon />
      </ExternalLink>
    </nav>
  );
}
