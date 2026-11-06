# Tinker A 版 Logo 接入

基线：main 1667501，工作区初始无未提交更改。仅替换已确认的 VI v4-A，不修改图片引用或其他已记录产品问题。

Library 来源：libfile_8013446618d481919d64ba8ac51797ea（主横版），libfile_749cfde83c748191b05501b67efb5e2e（完整资源包）。通过官方 Library 传输助手取到本机并校验可读，包 SHA256 b8ca5b730a75d1c2e0590c18c4b2a7c8daeb453cff78e811bd30054c6f543795。

侧栏/登录页采用横标且不重复排印 Tinker；首页/启动遮罩采用图形。深色与反色背景使用全白，浅色使用品牌黑蓝。保留原始 SVG 路径与比例，横标最小宽度 140px。应用图标从已交付 PNG 封装 ICNS/ICO，16/24px 保留 Micro 版；菜单栏使用 Micro 单色透明 Template @1x/@2x/@3x。

技术路径 resources/asci-logos 暂保留以兼容现有托盘资源加载；其中图形内容已替换为 Tinker。没有删除 LICENSE、NOTICE 或版权署名。安装包、发布和推送均不属于本轮操作。
