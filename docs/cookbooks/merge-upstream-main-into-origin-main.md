# Cookbook: Merge `upstream/main` into `origin/main`

This repo is configured so:

- `origin` = private fork (`holaOS-priv`)
- `upstream` = public repo (`holaOS`)

Use this cookbook when you want to bring the latest public `upstream/main` into your private `origin/main`.

## 1. Verify remotes

```bash
git remote -v
```

Expected shape:

```text
origin   git@github.com:holaboss-ai/holaOS-priv.git
upstream https://github.com/holaboss-ai/holaOS.git
```

## 2. Recommended flow: open a PR into `origin/main`

Use this when `main` is protected, which is the normal setup for this repo.

```bash
git fetch origin --tags
git fetch upstream --tags
git switch main
git pull --ff-only origin main
git switch -c sync/upstream-main-$(date +%Y%m%d)
git merge --no-ff upstream/main
git push -u origin HEAD
```

Then open the PR:

```bash
gh pr create \
  --base main \
  --head "$(git branch --show-current)" \
  --title "merge: sync upstream/main into origin/main" \
  --body "Merge the latest public upstream/main into the private fork main."
```

## 3. Direct push flow

Use this only if you intentionally want to update `origin/main` directly and have permission to do it.

```bash
git fetch origin --tags
git fetch upstream --tags
git switch main
git pull --ff-only origin main
git merge --no-ff upstream/main
git push origin main
```

## 4. If the merge conflicts

Check the conflicted files:

```bash
git status
```

Resolve the files manually, then continue:

```bash
git add <resolved-files>
git commit
```

If you are using the PR flow, push the branch:

```bash
git push -u origin HEAD
```

If you want to abandon the merge:

```bash
git merge --abort
```

## 5. Sanity checks after the merge

See the new merge commit and branch state:

```bash
git log --oneline --decorate --graph -n 10
git status
```

Check what `main` is tracking:

```bash
git branch -vv
```

## 6. Minimal command set

If you just want the shortest safe sequence:

```bash
git fetch origin
git fetch upstream
git switch main
git pull --ff-only origin main
git switch -c sync/upstream-main-$(date +%Y%m%d)
git merge --no-ff upstream/main
git push -u origin HEAD
```
