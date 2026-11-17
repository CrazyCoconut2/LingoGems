# LingoGems

Collect languages and keep them on this device.

```bash
npm start
```

Open `http://localhost:4200/`. Production build and deploy:

```bash
npm run build
npm run deploy
```

`deploy` bumps the patch version, builds, and publishes with Wrangler.

TODO
- The third icon for a card needs to be the amount of time it has been exercised. Not the eye icon. 
    -> We need an icon for exercising.
- Translations are always blurred. If you unblur too much
  that's usually a sign to rework the definition or other shit
  cause you don't want to systematically unblur. So we need to
  keep track of when the user unblurs.
    -> For that we need a number of unblurs before signaling to 
       the user that he needs to probably rework the definition.
- FORMS: Forms prioritized for example generation.
  If you choose one, it checks its metadata and recommends some to prioritize among the other forms when you want to create an example for another thing. Upon what the user writes.

Also, with the embedded browser we can save links for shit. Or put
them in examples, that's fucking great man it will be awesome.

TODO Later:
- Edit or delete metadata for all the elements : Example, modify
  mexico with a flag and it modified the region for all the things.