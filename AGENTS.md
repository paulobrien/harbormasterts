# Project instructions

- Harbor Master is the game; Treasure Island is its currently supported level.
- Keep original game files and generated asset bundles out of Git and source archives. Never commit an IPA, the `public/game/` bundle, credentials, or private asset URLs.
- Add or update automated tests when they meaningfully protect changed behaviour. Run the relevant unit, integration, build, and browser checks, and report checks that could not be run.
- For browser-test work, use the project-local Playwright best-practices skill in `.agents/skills/playwright-best-practices/SKILL.md` and consult the references relevant to the change.
- When Hallmark is requested, use the project-local skill in `.agents/skills/hallmark/SKILL.md`; preserve Harbor Master's identity and gameplay wiring.
- Stage and commit completed work in cohesive chunks, reviewing staged changes first. Attribute commits to Paul O'Brien <paul@modaco.com> without co-author trailers.
- Do not deploy unless requested. Preserve any distinction between a source-only build and a separately staged playable distribution.
