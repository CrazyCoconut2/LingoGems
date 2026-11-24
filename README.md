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
- Decide on the gems and how you get them
- TODO: We just have to know what happens if a form is not 
        present, so if an element exists but one of its forms in an example is not there. How should it act? And I think we're done. Maybe we can have duplicates or something. Same issue with the soft delete of an element. How do we deal with that?
        Tests need to be written for it.
- Phantom elements (from translations) and querying the
  whole data to get examples and definitions where the element is.
- The amount of time we translated stuff or opened a translation
  is also a useful metric. I think we should see it decrease through the days.
- The metric for the amount of times you saw the element 
  being translated is important to show too.

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
It's kind of the same way that we learn faster a mathematical thing by infering it. The best way to learn is to follow a thought process.
Is inference a path?
