# LingoGems

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.0.5.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

TODO
- Translations are always blurred. If you unblur too much
  that's usually a sign to rework the definition or other shit
  cause you don't want to systematically unblur. So we need to 
  keep track of when the user unblurs.
- Edit or delete metadata for all the elements : Example, modify
  mexico with a flat and it modified the region for all the things.
- FORMS: Forms prioritized for example generation. 
  If you choose one,it checks its metadata and recommends some to prioritize among the other forms when you want to create an example for another thing.
- We should be able to no longer have a support language. 
  Careful with this feature cause it affects lots of things.
- The game mode no longer needs to turn the cards around nor to do anything related to shuffling. All it needs to do is open the cards in game mode

Also, with the embedded browser we can save links for shit. Or put
them in examples, that's fucking great man it will be awesome.
