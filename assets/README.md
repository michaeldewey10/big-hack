# App icon

The Map page was removed. The terrain/foldable-map sections below describe historical assets retained in source; these images are not embedded in the current app.

`big-walk-icon-source.png` is the original Big Walk Steam icon extracted from the locally installed shortcut's ICO. `big-hack-icon.png` is its generated red color variant: all artwork, including the eye and pupil, uses shades of red, with the transparent background retained.

`big-hack.ico` packs the red artwork at 16, 24, 32, 48, 64, 128, and 256 pixels. `icon.rc` assigns it Windows resource ID 1, which GPUI uses for its window/taskbar icon. `build.rs` compiles and embeds this resource in BigHack.exe. See THIRD-PARTY-NOTICES.md for attribution.

## Terrain imagery

`terrain-map.png` is an unmodified PNG export of Big Walk's `MapAlbedo` Texture2D: `sharedassets2.assets`, path ID 271, 4096×4096, inside `Big Walk_Data/data.unity3d`. The texture is referenced by the MapColours material. It is decoded once into a shared GPU image and positioned behind the live map markers; no extra game rendering or camera is created.

The four Terrain components in `level2` have X/Z origins (-1024,0), (0,-1024), (-1024,-1024), and (0,0). Their TerrainData resolutions are 2049 with X/Z sample scale 0.5, giving 1024×1024 world units per tile. Together they cover X/Z [-1024,1024].

The original MaproomTerrainMesh UV/elevation relationship was compared with the four serialized height grids. Mapping u=(X+1024)/2048 and v=(Z+1024)/2048 gave an elevation correlation of 0.993909 across sampled vertices, substantially higher than the other axis/sign combinations. This supports the static coordinate mapping; live landmark alignment remains to be observed. PNG rows are drawn with +Z at the top.

## Foldable map

`foldable-map.png` is an unmodified PNG export of `PaperMapSaved`: Texture2D in `sharedassets2.assets`, path ID 270, 4096×4096. The shipped PaperMap material (path ID 67) references it directly in its `_Albedo` texture slot. This is the default background.

The image's capture framing is absent from the shipped scene. A preliminary coastline-derived projection is used only for an explicitly approximate overlay. Empty-location teleporting in this view requires three landmark correspondences captured from the local player, which define an affine world-X/Z to image-UV transform. The inverse transform converts image clicks back to world X/Z. Degenerate triangles, duplicate points, non-finite values, and projections outside supported bounds are rejected. The calibration is persisted with an image-version identifier. User-observed landmark accuracy remains necessary because the illustrated relief can have local distortion.
