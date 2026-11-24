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
- TODO: We just have to know what happens if a form is not 
        present, so if an element exists but one of its forms in an example is not there. How should it act? And I think we're done. Maybe we can have duplicates or something.
- Decide on the gems and how you get them
- Phantom elements (from translations) and querying the whole data 
  to get examples and definitions where the element is.
- The amount of time we translated stuff or opened a translation
  is also a useful metric. I think we should see it decrease through the days.
- The metric for the amount of times you saw the element 
  being translated is important to show too.
- To unlock elements you need to provide for a definition for it.
  if the definition (or translation) is valid you can use that
  to generate elements and that's how we can populate our shit.
- I feel like we can bring back the score coloring since 
  score is ultimately computed.

TODO Later:
- Edit or delete metadata for all the elements : Example, modify
  mexico with a flag and it modified the region for all the things.
- FORMS: 
      Forms prioritized for example generation.
      If you choose one, it checks its metadata and recommends some to prioritize among the other forms when you want to create an example for another thing. Upon what the user writes.

Also, with the embedded browser we can save links for shit. Or put
them in examples, that's fucking great man it will be awesome.

Question to answer later : 
Why do we infer faster than we can read the definition?
