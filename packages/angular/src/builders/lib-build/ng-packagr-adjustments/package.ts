/**
 * Updated from original ng-packagr
 *
 * this is to wire in a custom discoverPackages function that
 * does not take secondary entry points into account
 */
import * as fs from 'fs-extra';
import { NgPackagrOptions } from 'ng-packagr/lib/ng-package/options.di';
import { Transform } from 'ng-packagr/lib/graph/transform';
import { from, Observable, of as observableOf, pipe } from 'rxjs';
import { BuildGraph } from 'ng-packagr/lib/graph/build-graph';
import {
  concatMap,
  defaultIfEmpty,
  filter,
  map,
  mapTo,
  switchMap,
  takeLast,
  tap,
} from 'rxjs/operators';
import * as log from 'ng-packagr/lib/utils/log';
import * as path from 'path';
import { discoverPackages } from './discover-packages';
import { rimraf } from 'ng-packagr/lib/utils/rimraf';
import {
  byEntryPoint,
  EntryPointNode,
  isEntryPoint,
  ngUrl,
  PackageNode,
} from 'ng-packagr/lib/ng-package/nodes';
import { DepthBuilder } from 'ng-packagr/lib/graph/depth';
import { flatten } from 'ng-packagr/lib/utils/array';
import { STATE_IN_PROGESS } from 'ng-packagr/lib/graph/node';

export const nxPackageTransformFactory = (
  project: string,
  options: NgPackagrOptions,
  initTsConfigTransform: Transform,
  analyseSourcesTransform: Transform,
  entryPointTransform: Transform
) => (source$: Observable<BuildGraph>): Observable<BuildGraph> => {
  const pkgUri = ngUrl(project);

  const buildTransform = buildTransformFactory(
    project,
    analyseSourcesTransform,
    entryPointTransform
  );

  return source$.pipe(
    tap(() => log.info(`Building Angular Package`)),
    // Discover packages and entry points
    switchMap((graph) => {
      // custom Nx discoverPackages
      const pkg = discoverPackages(project);

      return from(pkg).pipe(
        map((value) => {
          const ngPkg = new PackageNode(pkgUri);
          ngPkg.data = value;

          return graph.put(ngPkg);
        })
      );
    }),
    // Clean the primary dest folder (should clean all secondary sub-directory, as well)
    switchMap((graph: BuildGraph) => {
      const { dest, deleteDestPath } = graph.get(pkgUri).data;
      return from(deleteDestPath ? rimraf(dest) : Promise.resolve()).pipe(
        map(() => graph)
      );
    }),
    // Add entry points to graph
    map((graph) => {
      const ngPkg = graph.get(pkgUri) as PackageNode;
      const entryPoints = [ngPkg.data.primary, ...ngPkg.data.secondaries].map(
        (entryPoint) => {
          const { destinationFiles, moduleId } = entryPoint;
          const node = new EntryPointNode(
            ngUrl(moduleId),
            ngPkg.cache.sourcesFileCache
          );
          node.data = { entryPoint, destinationFiles };
          node.state = 'dirty';
          ngPkg.dependsOn(node);

          return node;
        }
      );

      return graph.put(entryPoints);
    }),
    // Initialize the tsconfig for each entry point
    initTsConfigTransform,
    // perform build
    buildTransform
  );
};

const buildTransformFactory = (
  project: string,
  analyseSourcesTransform: Transform,
  entryPointTransform: Transform
) => (source$: Observable<BuildGraph>): Observable<BuildGraph> => {
  const pkgUri = ngUrl(project);
  return source$.pipe(
    // Analyse dependencies and external resources for each entry point
    analyseSourcesTransform,
    // Next, run through the entry point transformation (assets rendering, code compilation)
    scheduleEntryPoints(entryPointTransform),
    // Write npm package to dest folder
    writeNpmPackage(pkgUri),
    tap((graph) => {
      const ngPkg = graph.get(pkgUri);
      log.success(
        '\n------------------------------------------------------------------------------'
      );
      log.success(`Built Angular Package
 - from: ${ngPkg.data.src}
 - to:   ${ngPkg.data.dest}`);
      log.success(
        '------------------------------------------------------------------------------'
      );
    })
  );
};

const writeNpmPackage = (pkgUri: string): Transform =>
  pipe(
    switchMap((graph) => {
      const { data } = graph.get(pkgUri);
      const filesToCopy = Promise.all(
        [
          `${data.src}/LICENSE`,
          `${data.src}/README.md`,
          `${data.src}/CHANGELOG.md`,
        ]
          .filter((f) => fs.existsSync(f))
          .map((src) =>
            fs.copy(src, path.join(data.dest, path.basename(src)), {
              dereference: true,
              overwrite: true,
            })
          )
      );

      return from(filesToCopy).pipe(map(() => graph));
    })
  );

const scheduleEntryPoints = (epTransform: Transform): Transform =>
  pipe(
    concatMap((graph) => {
      // Calculate node/dependency depth and determine build order
      const depthBuilder = new DepthBuilder();
      const entryPoints = graph.filter(isEntryPoint);
      entryPoints.forEach((entryPoint) => {
        const deps = entryPoint.filter(isEntryPoint).map((ep) => ep.url);
        depthBuilder.add(entryPoint.url, deps);
      });

      // The array index is the depth.
      const groups = depthBuilder.build();

      // Build entry points with lower depth values first.
      return from(flatten(groups)).pipe(
        map(
          (epUrl) =>
            graph.find(
              byEntryPoint().and((ep) => ep.url === epUrl)
            ) as EntryPointNode
        ),
        filter((entryPoint) => entryPoint.state !== 'done'),
        concatMap((ep) =>
          observableOf(ep).pipe(
            // Mark the entry point as 'in-progress'
            tap((entryPoint) => (entryPoint.state = STATE_IN_PROGESS)),
            mapTo(graph),
            epTransform
          )
        ),
        takeLast(1), // don't use last as sometimes it this will cause 'no elements in sequence',
        defaultIfEmpty(graph)
      );
    })
  );
