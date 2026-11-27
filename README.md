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
- Feature when writing something with *.
  => So I think this is another genius feature. When somebody
      writes something, they often times think in their other language so they'll say something like "Passe moi la *spoon*". The AI could automatically detect that and suggest a change for the phrase that the user can accept.
      So the first step would be to replace those elements,
      then correct via the correction, then reformulate.
- Phantom elements (from translations) and querying the
  whole data to get examples and definitions where the element is.
- The amount of time we translated stuff or opened a
  translation is also a useful metric. I think we should see it decrease through the days.
- Optimization for stats : If stats don't exist in localStorage, we compute everything. If they do exist we only compute the stats for the current day.
- The metadata for the elements will remain in english but need a translation for each. They're static data so it should
not be extremely complicated.

TODO Later:
- Edit or delete metadata for all the elements : Example, modify mexico with a flag and it modified the region for all the things.
- FORMS: 
      Forms prioritized for example generation.
      If you choose one, it checks its metadata and recommends some to prioritize among the other forms when you want to create an example for another thing. Upon what the user writes.

Also, with the embedded browser we can save links for shit. Or put
them in examples, that's fucking great man it will be awesome.

Question to answer later : 
Why do we infer faster than we can read the definition?
It's kind of the same way that we learn faster a mathematical thing by infering it. The best way to learn is to follow a thought process.
Is inference a path?

We could rebaptize this project Semaphoro.ai
Cause that's what it is in essence man. Green you're supposed
to go, if you stop at it you lose points. Yellow means you should slow down, red you should stop (click on it).