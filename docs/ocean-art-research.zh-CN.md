# 海面优化与素材来源

更新：2026-09-08。

默认目标是轻快的卡通海上竞速：宽而低的涌浪、蓝绿层次、流动细水纹、柔和反光、少量白沫。船仍然受可见海面驱动，保留顶浪、侧倾和离水惯性；细水纹只改变光照，不增加船体受力。

## 网上素材筛选

| 来源 | 用途与选择 | 许可 |
| --- | --- | --- |
| [Three.js r184 waternormals.jpg](https://github.com/mrdoob/three.js/blob/r184/examples/textures/waternormals.jpg) | 已接入。官方海面示例使用的可平铺法线纹理，双层异向流动，可独立于基础色控制水面细节。原始 JPEG 248,813 字节。 | Three.js 仓库 MIT；完整许可证随发行版放在 public/licenses/three-water-MIT.txt |
| [OpenGameArt — Seamless water tiles](https://opengameart.org/content/seamless-water-tiles) | Hazmat Harry 的亮/暗水面贴图。备选美术参考，未打包；有固定底色，不如法线素材适合本项目的两种环境配色。 | 页面标注 CC0 |
| [ProcTexture — Water Surface](https://proctexture.com/textures/water/surface-water/water-surface) | 可平铺 PBR 水面贴图集，作为后续法线/高度图备选，未打包。 | 页面标注 CC0 |

实际素材从固定的 r184 路径下载，不依赖运行时外链：
https://raw.githubusercontent.com/mrdoob/three.js/r184/examples/textures/waternormals.jpg

运行时由 Vite 打包为本地带哈希资源；法线按线性数据读取，启用重复采样、mipmap 和有限各向异性过滤。载入失败时保留几何波、反光和程序泡沫；切换赛道时释放纹理与几何。

## 研究与落地

- [NVIDIA GPU Gems 1：Effective Water Simulation from Physical Models](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models)
  - 采用“几何涌浪 + 法线细波”分层，并用解析导数获得平滑法线。
  - 近处保留细水纹，远处衰减高频细节以控制闪烁。
  - 保留现有 CPU/GPU 共享高度场，不为追求外观引入 FFT 模拟成本。
- [Three.js Water 文档](https://threejs.org/docs/pages/Water.html)及[官方海面示例](https://threejs.org/examples/webgl_shaders_ocean.html)
  - 参考法线贴图、太阳高光和视角相关反射的组合。
  - 本项目使用定制轻量着色器，未引入镜面反射的额外场景渲染通道。
- [Rare：The Technical Art of Sea of Thieves，SIGGRAPH 2018](https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf)
  - 参考其风格化环境与实时技术结合的美术方向。
  - 该公开摘要不提供完整海洋着色器；本项目没有复制、提取该游戏的素材或声称复刻其海洋算法。

## 实现

- SeaStatePresets.ts：fair / breezy 为普通赛道海况。rough / storm 原样保存上一版汹涌参数，留给未来天气系统；尚未增加天气调度或玩家天气菜单。
- 默认总振幅：sunset 2.20 → 0.82（约降低 63%）；reef 3.36 → 1.11（约降低 67%）。同时降低波频与传播速度，使长涌浪占主导。
- Ocean.ts：连续蓝绿色与轻量天空反射替代硬色阶；局部破碎白沫替代大片白色浪头。法线细节不影响浮力。
- OceanGeometry.ts：近处平面 + 中远两圈无重叠网格。边界顶点一致，三圈共用中心，无高度偏移或相互穿插，保持 3 个海面绘制调用。
- ArcadeBoat 的重力、俯仰侧倾惯性、腾空与落水反馈保留。正常海况不再要求持续腾空，大浪回归测试直接使用保留的 rough / storm 预设。

## 验证入口

- tests/ocean-presentation.spec.ts：两个默认海况、四个航向的 30 秒航行；接水时间、姿态与起伏范围；网格接缝、重叠和朝向。
- tests/rough-sea.spec.ts：保留海况的自然离水、重落水及重力测试。
- tests/rough-sea-browser.spec.ts：真实油门输入、纹理请求、运行时错误、桌面/手机截图。
- artifacts/ocean-refresh/：本轮截图与航行数据。artifacts/rough-sea/ 保留上一版大浪截图，便于前后比较。

## 本轮验证结果

- 构建通过；47 项针对性检查通过（39 项竞速/联网/默认海况/接缝检查，3 项保留风暴物理检查，4 项桌面/手机构建版画面检查，1 项性能检查）。
- 两个默认海况各测试四个航向、每航向 30 秒：普通全油门测试未出现腾空；俯仰峰值约 7–10 度、侧倾约 3–6 度，仍有随浪升沉。该结果不代表所有航向、相位、加速组合都不会短暂离水。
- 保留 rough / storm 的连续 30 秒测试仍产生腾空和重落水。
- 多次真实菜单切换赛道后纹理数保持 8，无持续增长；CPU/GPU 海况与联网预测回放检查通过。
- 构建版 1920×1080，RTX 4060 Laptop / Chrome，约 8.4 秒采样：平均 60.06 FPS，P95 17.0 ms，P99 17.1 ms，无超过 25 ms 的帧。此为本机测量，不外推到其他设备。
- 素材 SHA-256：ADD9912B158A4FE9C12421745BABE68C44C8AF75631AC4837236CB2A03BC373F。
