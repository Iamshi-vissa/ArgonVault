# React Bits components

These components are copied from [React Bits](https://github.com/DavidHDev/react-bits) by David Haz (TypeScript + Tailwind variants), under its MIT + Commons Clause licence, which allows use as part of an application. They're kept as published so they can be compared with upstream, and they're excluded from linting and formatting.

| Component | Upstream path | Used for | Local changes |
| --- | --- | --- | --- |
| AeroShards | `src/ts-tailwind/Backgrounds/AeroShards` | Landing-page background (WebGPU) | None. Requires `vgpu@0.3.1` (pinned). |
| ParticleText | `src/ts-tailwind/TextAnimations/ParticleText` | Landing-page wordmark | A resting pointer no longer keeps the animation loop running every frame. |
| VariableProximity | `src/ts-tailwind/TextAnimations/VariableProximity` | Landing-page text | Removed the Google Fonts import and the Roboto Flex font-family, so it uses the app's self-hosted variable fonts (the security policy blocks external fonts). Scrolling releases the letters instead of re-measuring every letter on every scroll event, which caused scroll lag. |
| AnimatedContent | `src/ts-tailwind/Animations/AnimatedContent` | Entrance and scroll reveals | None |
| AnimatedList | `src/ts-tailwind/Components/AnimatedList` | Session list | None (themed through its CSS variables) |
| HoldButton | `src/ts-tailwind/Micro/HoldButton` | Hold to lock | None |
| RubberSegment | `src/ts-tailwind/Micro/RubberSegment` | Lock/Unlock and option switches | None |
| StatusMark | `src/ts-tailwind/Micro/StatusMark` | Progress and result marks | None |
| DecryptedText | `src/ts-tailwind/TextAnimations/DecryptedText` | Seal code and note reveal | None |

When updating a component, copy the new upstream file over the old one and re-apply the local change listed above.
