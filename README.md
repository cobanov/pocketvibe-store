<p align="center">
  <img src="https://raw.githubusercontent.com/cobanov/pocketvibe/main/site/public/favicon.svg" alt="PocketVibe icon" width="88">
</p>

<h1 align="center">PocketVibe Store</h1>

<p align="center">
  <strong>Every game on PocketVibe handhelds, and how to add yours.</strong><br>
  Open source games, built from their source and reviewed in the open.
</p>

<p align="center">
  <a href="#add-your-game"><strong>Add your game</strong></a> ·
  <a href="https://pocketvibe.dev">PocketVibe</a> ·
  <a href="https://pocketvibe.dev/make/">Make a game</a> ·
  <a href="https://github.com/cobanov/pocketvibe-store/pulls">Pull requests</a>
</p>

This repository is the PocketVibe store's catalog, the way F-Droid and Flathub work. Each game is
one small file in [`games/`](games) that points at the game's own repository and a commit. Adding
or updating a game is a pull request: it is built from that source and checked automatically,
anyone can try it on a handheld, and once it is merged it reaches every PocketVibe handheld within
minutes.

## Add your game

The easy way, from your game's folder (a project made with `npm create pocketvibe`, in a public
GitHub repository):

```sh
npx pocketvibe publish
```

It checks the game, opens the pull request here, and tells you where to follow it. Your AI coding
agent can run it for you.

By hand, add `games/<id>.json`:

```json
{
  "id": "snow-race",
  "owner": "your-github-username",
  "age": 4,
  "source": {
    "repo": "https://github.com/your-github-username/snow-race",
    "commit": "the full 40-character commit hash",
    "path": "."
  }
}
```

- `id` is the game's id from its `pocketvibe.json`, and the file's name.
- `owner` is you: only the owner can update the game later.
- `age` is the youngest age the game suits, as the App Store rates apps: `4`, `9` (mild cartoon
  or fantasy violence), `13`, `16` (for example suggestive themes) or `18` (for example realistic
  violence). The iPhone app lists only games rated for its own rating, so a game without one is
  missing there. The maintainer checks it in review.
- `source.path` is the folder with `pocketvibe.json`, if it is not the repository's root.

The title, version, description, genre, controls and cover come from the game's own
`pocketvibe.json` and `cover.png` at that commit.

## What happens next

- **The check.** The pull request builds the game from its source (`npm ci`, then Vite) and
  checks its listing, its version, its cover and its size. The report is on the pull request's
  Checks tab, and the built game is attached there.
- **Playing it.** Anyone can try it on their handheld with `npx pocketvibe review <number>`, the
  pull request's number, or in the browser with the attached build.
- **The review.** We play every game before it goes in. Feedback and the reasons for any change we
  ask for stay on the pull request.
- **Merged means published.** A merge builds the game again and publishes it to the store.

## Updating your game

Raise `version` in `pocketvibe.json`, commit, push, and run `npx pocketvibe publish` again. It
opens a pull request that moves your game's file to the new commit.

## What review checks

- It is a finished game, not a test or a demo: a title screen, a goal, a way to win or lose, and a way to play again.
- It plays smoothly on a handheld, close to 60 fps in its busiest moment ([the measured limits](https://pocketvibe.dev/make/#budget)).
- Everything works with the buttons alone, and the hints on screen name them.
- It works offline and loads nothing from the internet.
- Its listing is complete, with a `cover.png` (480×270) that shows the game.
- It is suitable for everyone, and you have the right to use every image, sound and model in it.
- Its repository is public and open source (MIT is a good default), and the zip is under 50 MB.

---

The catalog and scripts are under the [MIT license](LICENSE). Each game is under its own license, in
its own repository.
