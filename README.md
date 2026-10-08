# Physical AI 개념 지도

Physical AI 개념 1,700여 개를 자율주행·SW 관점으로 정리한 실무 엔지니어용 학습 지도입니다.
GitHub Pages에서 빌드 없이 그대로 서비스되는 정적 사이트입니다.

## 구조

```
index.html              앱 셸 (헤더·패널·모달)
assets/app.css          스타일 (라이트/다크)
assets/app.js           앱 번들 (tools/app/main.js 를 esbuild로 묶은 결과, d3 일부 포함)
sw.js                   서비스 워커 (오프라인·재방문 캐시)
.nojekyll               Jekyll 처리 끄기
data/
  version.json          콘텐츠 해시 — 바뀌면 모든 데이터 URL(?v=)이 새로 받아짐
  skeleton.json         노드 이름·표식·트리 구조 (첫 화면에 필요한 유일한 데이터)
  paths.json            학습 경로 9개 (노드 id로 해석된 상태)
  glossary.json         약어 사전 (사전을 열 때 로드)
  d/<영역>.json         영역별 상세 설명 13개 (노드를 열 때 해당 영역만 로드)
diagrams/light|dark/    Mermaid를 미리 렌더링한 SVG 226개 × 2 테마
src/
  tree.json             ★ 원본 데이터 (편집은 여기서)
  paths.json            ★ 학습 경로 원본 (단계 = "상위 > 노드" 이름 경로)
tools/
  build.sh              전체 빌드 (데이터 → 다이어그램 → 앱 번들)
  build_data.py         src → data/ 생성
  render_diagrams.js    Mermaid → SVG (Playwright 사용)
  app/main.js           앱 소스
  package.json          빌드 도구 의존성 (런타임에는 불필요)
```

## 콘텐츠 수정 → 배포

1. `src/tree.json` 또는 `src/paths.json` 수정
2. 빌드
   ```bash
   tools/build.sh                    # 처음엔 tools/ 에서 npm install 이 자동 실행됨
   SKIP_DIAGRAMS=1 tools/build.sh    # 다이어그램(dg 필드) 변경이 없으면 렌더링 생략
   ```
3. 로컬 확인: 저장소 루트에서 `python3 -m http.server 8000` → http://localhost:8000
4. 커밋·푸시 → GitHub Pages가 그대로 서비스

`src/tree.json` 노드 필드: `n` 이름, `d` 정의, `sw` SW 구현 포인트, `tech` 대표 기술(쉼표 구분),
`issue` 실무 이슈, `feat` 주요 구성(배열), `src` 참고 자료(`[{t,u}]`), `url` 공식 사이트,
`dg` Mermaid 코드, `rel` 관련 노드(이름 경로 배열), `av` 자율주행 관점, `swl` SW 항목, `tool` 도구·프레임워크, `c` 하위 노드.

노드 id는 트리 DFS 순서(루트 = 0)이며 공유 링크 `#n{id}`에 쓰입니다. 노드를 중간에 추가·삭제하면
뒤쪽 id가 밀려 기존 공유 링크가 다른 노드를 가리킬 수 있습니다.

## 성능 (gzip 기준)

| 항목 | 크기 | 시점 |
|---|---|---|
| 첫 화면 (HTML·CSS·JS·skeleton·paths) | 약 60 KB | 진입 시 |
| 영역별 상세 설명 | 영역당 60~130 KB, 전체 약 1.1 MB | 노드를 열 때 해당 영역만 · 데스크톱은 유휴 시간에 미리 받음 |
| 다이어그램 SVG | 개당 약 3 KB | 해당 노드를 열 때 |
| 약어 사전 | 약 18 KB | 사전을 열 때 |

이전 단일 HTML(약 3.5 MB, gzip 약 1.1 MB + Mermaid 런타임 약 1 MB) 대비 첫 화면 전송량이 약 1/30로 줄었습니다.
데이터 URL에는 `?v=<콘텐츠 해시>`가 붙어 있어 서비스 워커가 영구 캐시하고, 콘텐츠가 바뀌면 자동으로 새로 받습니다.

## 학습 흐름

- 첫 방문 시 사용법 안내 → 입문 경로 / 역할별 경로 / 자유 탐색 중 선택
- 학습 경로: 경로 막대(진행률·현재 단계·이전/다음)와 패널 하단의 "완료하고 다음 단계"
- 자유 탐색: 패널 하단의 "다음으로 볼 개념" 추천(첫 미완료 하위 → 다음 형제)
- 진도는 브라우저 localStorage(`pai-map-learned-v1`)에 저장되며 기기 간 동기화되지 않습니다.
- 화면 폭 720px 이하에서는 목록형이 기본이며, 설명은 전체 화면 시트로 열립니다.
