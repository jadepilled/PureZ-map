# PureZ Map

Interactive loot and spawn map for PureZ servers, live at [map.purez.gg](https://map.purez.gg). Static site; GitHub Pages serves this branch as-is.

## What it shows

Everything comes from the mission files each server runs:

| Layer | Source |
|---|---|
| Loot buildings, coloured by loot type, and per-building loot | `mapgrouppos.xml`, `mapgroupproto.xml` |
| Item lookup (where an item can spawn) | `types.xml` rules matched against each building's containers, usage and area tier |
| Loot tier outlines | `areaflags.map` |
| Vehicles, heli crashes, convoys, wrecks, crates, planks and bricks, random gas zones | `db/events.xml` (active events only) + `cfgeventspawns.xml` |
| Wells | `mapgrouppos.xml` (well pumps) |
| Fruit trees, berry bushes | `mapgroupcluster*.xml` |
| Animals | `cfgenvironment.xml` + `env/*_territories.xml` |
| Infected areas | `env/zombie_territories.xml` |
| Gas zones, player spawns | `cfgeffectarea.json`, `cfgplayerspawnpoints.xml` |
| Item names | the wiki's `names.json` |
| Place names | world config `CfgWorlds <World> Names` (via the wiki's config extractor) |

## Updating a map

```sh
python tools/extract.py --id nasdara --name Nasdara --mission ../PureZ/PureZ.nasdara \
    --areaflags ../PureZ/PureZ.nasdara/areaflags.map \
    --names ../PureZ-wiki/_site/static/names.json \
    --configs ../PureZ-wiki/data/configs.json --world <CfgWorlds class>
```

This writes `maps/<id>/data.json`, `world.json` (loaded when a world layer is switched on) and `tiergrid.png` (tier under the cursor).

Add `--cetool <CE tool folder>` for maps whose CE tool project includes a sea mask.

## Imagery

- **Satellite:** `python tools/satellite.py <world>/data/layers <map id>` stitches the terrain's `s_XXX_YYY_lco.paa` tiles and writes `maps/<id>/tiles/satellite`.
- **Topographic:** `python tools/topo.py <heightmap.asc|.npy|.png> <map id>` renders contours and hillshade into `maps/<id>/tiles/topographic`.
- Any square image: `python tools/tiles.py <image> maps/<id>/tiles/<layer>`.

Then list the layer in that map's `base` array in `maps.json` (and its deepest zoom as `satelliteZoom` / `topoZoom`).

## Adding a map

Run the extractor with a new `--id`, add an entry to `maps.json`, and it appears as a tab.

Chernarus satellite image and economy data © Bohemia Interactive, used under ADPL-SA. Icons from [Tabler Icons](https://tabler.io/icons), MIT License.
