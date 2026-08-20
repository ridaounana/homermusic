# Bot avatars

Files are matched to fleet accounts by position, 1-based, where 1 is the
primary bot (the one that owns the slash commands):

```
avatar-1.png   banner-1.png    Homer      (primary)
avatar-2.png   banner-2.png    Homer 2
avatar-3.png   banner-3.png    Homer 3
avatar-4.png   banner-4.png    Homer 4
```

Apply them with:

```bash
npm run avatars -- --dry-run    # show what would change
npm run avatars                 # apply
```

Avatars should be square, at least 512x512, under 10 MB. PNG, JPG or GIF.
A missing file is skipped, so adding a fifth bot and re-running only touches
the fifth. Banners are optional and only visible when someone opens the
profile card.

Discord rate-limits these endpoints hard. The script spaces requests out and
stops on a 429 rather than half-applying a set.
