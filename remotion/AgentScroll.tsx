import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

const sections = [
  ['国产 AI Agent 到底适不适合普通人？', '不比参数表，只聊上手门槛、日常效率和真实短板。'],
  ['为什么要找替代方案', '国外工具很好，但从账号、渠道到配置，对普通用户第一步并不短。'],
  ['Trae：先把能做事摆到桌面上', '手机与电脑联动，本地文件与云端任务都能继续推进。'],
  ['WorkBuddy：懂办公上下文的同事', '把文件、文档和协作工具接进同一个工作流。'],
  ['ZCode：把重点放在写代码上', '适合已有项目、想让 Agent 持续参与工程的人。'],
  ['怎么选', '先选能稳定跑通你一个真实任务的工具。'],
  ['Agent 的价值', '不是替你决定，而是把你从重复操作里放出来。'],
];

export const AgentScroll: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const progress = frame / Math.max(1, durationInFrames - 1);
  const sectionHeight = height * 0.93;
  const virtualHeight = sections.length * sectionHeight;
  const y = interpolate(progress, [0, 1], [0, -(virtualHeight - height)]);
  return <AbsoluteFill style={{ background: '#e8ebe4', fontFamily: 'Microsoft YaHei, sans-serif', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', top: 0, left: 0, width, transform: `translateY(${y}px)` }}>
      {sections.map(([title, text], index) => <section key={title} style={{ height: sectionHeight, padding: 110, display: 'flex', flexDirection: 'column', justifyContent: 'center', background: index % 2 ? '#f7f6f2' : '#18252f', color: index % 2 ? '#16202b' : '#fff', borderBottom: '1px solid #d8d9d3' }}>
        <div style={{ color: index % 2 ? '#2f64f4' : '#d7f25c', fontWeight: 800, fontSize: 22, marginBottom: 32 }}>0{index + 1} / 国产 Agent 实测</div>
        <h1 style={{ maxWidth: 1380, fontSize: 78, lineHeight: 1.12, margin: 0 }}>{title}</h1>
        <p style={{ maxWidth: 930, fontSize: 31, lineHeight: 1.7, opacity: .78, marginTop: 38 }}>{text}</p>
        {index > 1 && index < 5 ? <div style={{ position: 'absolute', right: 110, bottom: 100, width: 430, height: 240, padding: 24, border: '1px solid #76909e', background: '#101a23', color: '#dce7ed' }}><div style={{ color: '#d7f25c', fontSize: 14, fontWeight: 800 }}>能力示意 · 非官方界面</div><div style={{ marginTop: 25, fontSize: 22, fontWeight: 800 }}>任务正在推进</div><div style={{ height: 10, width: '78%', marginTop: 26, background: '#d7f25c' }} /><div style={{ height: 10, width: '56%', marginTop: 14, background: '#577282' }} /><div style={{ height: 10, width: '68%', marginTop: 14, background: '#577282' }} /></div> : null}
      </section>)}
    </div>
    <div style={{ position: 'absolute', top: 0, left: 0, height: 7, width: `${progress * 100}%`, background: '#ff6b35' }} />
  </AbsoluteFill>;
};
