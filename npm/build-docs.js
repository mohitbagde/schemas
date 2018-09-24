#!/usr/bin/env node

const path = require('path'),

    _ = require('lodash'),
    fse = require('fs-extra'),
    semver = require('semver'),
    mustache = require('mustache'),

    tools = require('../index'),

    SCHEMA_DIR = path.join(__dirname, '..', 'schemas'),
    BASE_ASSET_DIR = path.join(__dirname, '..', 'dist'),
    BASE_OUTPUT_DIR = path.join(__dirname, '..', 'webout'),
    OUTPUT_DIR = path.join(BASE_OUTPUT_DIR, 'json'),
    STATUS_MAP_BOOTSTRAP = {
        draft: 'warning',
        stable: 'success',
        rc: 'primary'
    };

/**
 *
 * @param {String} version - Schema Version
 * @param {String} draft - The JSON draft version to build for.
 */
function buildVersion (version, draft) {
    let versionDir = path.join(OUTPUT_DIR, draft === 'draft-04' ? '' : draft, version, 'docs'),
        outputSchemaFile = path.join(OUTPUT_DIR, draft === 'draft-04' ? '' : draft, version, 'collection.json'),
        schemaFile = path.join(SCHEMA_DIR, draft, version, 'collection.json'),
        versionSchemaDir = path.join(SCHEMA_DIR, draft, version),
        templateFile = path.join(BASE_ASSET_DIR, 'index.mustache'),
        compiledSchema = tools.compile(schemaFile, versionSchemaDir),
        templateContent = fse.readFileSync(templateFile),
        renderedTemplate;

    console.info('Building docs for %s ...', version);
    fse.mkdirpSync(versionDir);

    console.info('Created directory %s', versionDir);
    fse.writeFileSync(outputSchemaFile, JSON.stringify(compiledSchema, null, 4));

    // Compile the mustache template
    renderedTemplate = mustache.render(templateContent.toString(), { version });
    fse.writeFileSync(path.join(versionDir, 'index.html'), renderedTemplate);
}

/**
 *
 * @param {String} version - Schema Version
 * @param {String} draft - The JSON draft version to build for
 */
function buildLatest (version, draft) {
    const versionDocsDir = path.join(OUTPUT_DIR, draft === 'draft-04' ? '' : draft, version),
        latestDocsDir = path.join(OUTPUT_DIR, draft === 'draft-04' ? '' : draft, 'latest');

    fse.copySync(versionDocsDir, latestDocsDir);
    console.info('Copied %s as the latest version', version);
}

/**
 *
 * @param {String[]} versions - Schema Versions
 */
function getStableVersions (versions) {
    return versions.filter((val) => {
        return (/v\d+\.\d+\.\d+$/i).test(val);
    });
}

/**
 *
 * @param {String[]} versions - Schema Versions
 */
function getLatestStable (versions) {
    return _.reduce(getStableVersions(versions), (versionA, versionB) => {
        return (semver.gt(semver.clean(versionA), semver.clean(versionB), true)) ? versionA : versionB;
    });
}

/**
 *
 * @param {String[]} versions - Schema Versions
 * @param {String} draft - The JSON draft version to build for
 */
function buildSymlinks (versions, draft) {
    const stableVersions = getStableVersions(versions),

        // groups versions by major: { "1": ["1.0.1", "1.2.0"], "2": ["2.0.0", "2.1.0"]
        groupedByMajor = _.groupBy(stableVersions, (version) => {
            return semver.major(version, true);
        });

    //  [
    //      {"major": "1", "latest": "1.2.0"},
    //      {"major": "2", "latest": "2.1.0"}
    //  ]
    let mapping = _.map(groupedByMajor, (versions, major) => {
        return {
            major: major,
            latest: _.reduce(versions, (versionA, versionB) => {
                return (semver.gt(semver.clean(versionA), semver.clean(versionB), true)) ? versionA : versionB;
            })
        };
    });

    mapping = _.zipObject(_.map(mapping, 'major'), _.map(mapping, 'latest'));

    _.forEach(mapping, (latest, major) => {
        const src = path.relative(OUTPUT_DIR, path.join(OUTPUT_DIR, latest)),
            dest = path.join(OUTPUT_DIR, draft === 'draft-04' ? '' : draft, 'v' + major.toString());

        fse.symlinkSync(src, dest);
    });
}

/**
 *
 * @param {String[]} versions - Schema Versions
 */
function buildToc (versions) {
    const templateFile = path.join(BASE_ASSET_DIR, 'table_of_contents.mustache'),
        templateContent = fse.readFileSync(templateFile);

    let renderedTemplate,
        allversions;

    console.info('Creating a Table of Contents...');

    allversions = _.map(versions, (version) => {
        let raw = version,
            semVersion = semver.SemVer(version),
            status,
            bootstrapClass;

        status = _.isArray(semVersion.prerelease) && semVersion.prerelease.length ?
            semVersion.prerelease[0] : 'stable';

        bootstrapClass = STATUS_MAP_BOOTSTRAP[status];

        if (!bootstrapClass) {
            throw new Error('Invalid status "' + status + '". Please use a valid semver pre-release tag. ' +
                'It should be one of ' + _.keys(STATUS_MAP_BOOTSTRAP));
        }

        return {
            raw,
            status,
            bootstrapClass
        };
    });
    renderedTemplate = mustache.render(templateContent.toString(), { versions: allversions });
    fse.writeFileSync(path.join(BASE_OUTPUT_DIR, 'index.html'), renderedTemplate);
}

/**
 * Main handler
 */
function main () {
    fse.readdirSync(SCHEMA_DIR).forEach((draft) => {
        const outDir = path.join(OUTPUT_DIR, draft === 'draft-04' ? '' : draft),
            versions = fse.readdirSync(path.join(SCHEMA_DIR, draft));

        // Ensures that versions are displayed in the descending order in the ToC
        versions.sort(semver.rcompare);
        console.info('Output directory is: %s', outDir);

        // Check if output directory exists, and remove it if it's there
        if (fse.existsSync(outDir)) {
            console.info('Output directory exists! Removing the existing one.');
            fse.removeSync(outDir);
        }

        // Create output directory
        fse.mkdirpSync(outDir);

        // Copy statics assets (js, css, etc)
        fse.copySync(BASE_ASSET_DIR, outDir);

        // Create the table of contents
        buildToc(versions);

        versions.forEach((version) => {
            buildVersion(version, draft);
        });

        // Remove templates from output directory.
        fse.remove(path.join(outDir, 'index.mustache'));
        fse.remove(path.join(outDir, 'table_of_contents.mustache'));


        // Construct the docs for the latest stable version.
        console.info('Building docs for the latest...');
        buildLatest(getLatestStable(versions), draft);

        // Create symlinks for stable versions.. v1 => v1.0.0, etc.
        console.info('Creating symlinks from major versions to the latest...');
        buildSymlinks(versions, draft);
    });
}

main();
