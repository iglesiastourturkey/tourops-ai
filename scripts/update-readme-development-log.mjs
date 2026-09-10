import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const README_PATH = "README.md";
const START = "<!-- RECENT_DEVELOPMENTS:START -->";
const END = "<!-- RECENT_DEVELOPMENTS:END -->";
const MAX_COMMITS = 20;

const ignoredSubjects = [
  /^docs\(readme\): sync development log/i,
  /^chore\(docs\): sync development log/i,
  /^merge /i,
];

const categoryMap = [
  [/^feat(\(.+\))?:/i, "Features"],
  [/^fix(\(.+\))?:/i, "Fixes"],
  [/^refactor(\(.+\))?:/i, "Refactors"],
  [/^perf(\(.+\))?:/i, "Performance"],
  [/^test(\(.+\))?:/i, "Tests"],
  [/^docs(\(.+\))?:/i, "Documentation"],
  [/^(build|ci)(\(.+\))?:/i, "Build & CI"],
  [/^chore(\(.+\))?:/i, "Maintenance"],
];

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function cleanSubject(subject) {
  return subject.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "").trim();
}

function classify(subject) {
  const match = categoryMap.find(([pattern]) => pattern.test(subject));
  return match?.[1] ?? "Other";
}

function getRecentCommits() {
  const raw = runGit([
    "log",
    `-${MAX_COMMITS + 10}`,
    "--date=short",
    "--pretty=format:%h%x1f%ad%x1f%s%x1e",
  ]);

  return raw
    .split("\x1e")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [sha, date, subject] = row.split("\x1f");
      return { sha, date, subject };
    })
    .filter(({ subject }) => !ignoredSubjects.some((pattern) => pattern.test(subject)))
    .slice(0, MAX_COMMITS);
}

function render(commits) {
  if (commits.length === 0) {
    return `${START}\n\n## Recent Developments\n\n_No recent development commits found._\n\n${END}`;
  }

  const grouped = new Map();
  for (const commit of commits) {
    const category = classify(commit.subject);
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(commit);
  }

  const preferredOrder = [
    "Features",
    "Fixes",
    "Refactors",
    "Performance",
    "Tests",
    "Documentation",
    "Build & CI",
    "Maintenance",
    "Other",
  ];

  const sections = [];
  for (const category of preferredOrder) {
    const items = grouped.get(category);
    if (!items?.length) continue;

    sections.push(`### ${category}`);
    for (const { sha, date, subject } of items) {
      sections.push(`- ${cleanSubject(subject)} — \`${sha}\` (${date})`);
    }
    sections.push("");
  }

  return [
    START,
    "",
    "## Recent Developments",
    "",
    "> Automatically generated from recent commits on `main`. Keep product overview, architecture and roadmap sections curated by humans.",
    "",
    ...sections,
    END,
  ].join("\n");
}

function updateReadme() {
  const readme = readFileSync(README_PATH, "utf8");
  const generated = render(getRecentCommits());

  let next;
  if (readme.includes(START) && readme.includes(END)) {
    const pattern = new RegExp(`${START}[\\s\\S]*?${END}`, "m");
    next = readme.replace(pattern, generated);
  } else {
    const roadmapHeading = /\n---\n\n## Roadmap\n/;
    if (roadmapHeading.test(readme)) {
      next = readme.replace(roadmapHeading, `\n---\n\n${generated}\n\n---\n\n## Roadmap\n`);
    } else {
      next = `${readme.trimEnd()}\n\n---\n\n${generated}\n`;
    }
  }

  if (next !== readme) {
    writeFileSync(README_PATH, next, "utf8");
    console.log("README recent development log updated.");
  } else {
    console.log("README development log is already current.");
  }
}

updateReadme();
