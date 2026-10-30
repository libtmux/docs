---
supportedPorts: []
title: コンセプト
description: tmux のオブジェクト、コマンドの通信方式、クエリ、ワークスペース。
sidebar:
  label: 概要
  group: コンセプト
  order: 1
cards:
  - label: サーバー、セッション、ウィンドウ、ペイン
    href: server-session-window-pane/
    body: tmux のオブジェクト階層と、アタッチ中のクライアントを理解します。
  - label: コントロールモードとワンショット
    href: transports/
    body: サブプロセスのコマンド、持続的な接続、バッチ実行から選びます。
    ports: [root, py, ts, rs, go, java, csharp, cxx, swift]
  - label: フィルタリングとクエリ
    href: queries/
    body: オブジェクトを探し、該当がない場合や複数に該当する場合を扱います。
    ports: [root, py, ts, rs, go, java, csharp, cxx, swift]
  - label: ワークスペース
    href: workspaces/
    body: コマンドまたは tmux のコマンドファイルでペインのレイアウトを組み立てます。
    ports: [root, py, ts, rs, go, java, csharp, cxx, swift]
  - label: ネイティブガイド
    href: ../guides/
    body: ライブラリのクエリ、実行、リソース所有権の API を学びます。
    ports: [ruby, lua]
source_commit: c07c3189c625c7b121e50107ee3863524883ba53
translator: claude-sonnet-5-5
reviewed: false
---

tmux はセッションを作成し、その中にウィンドウとペインを配置します。デタッチしても、そこで動いているプログラムは実行され続けます。
まずオブジェクトの階層を読み、そのあとコマンドクライアント、フィルタリング、ワークスペースのレイアウトへ進んでください。

コンセプトのページには、専用のサーバー上で動く完全なシェルスクリプトが含まれています。
実行中の状態を調べるには [`list-sessions`](/tmux/latest/manual/list-sessions/) と [`list-panes`](/tmux/latest/manual/list-panes/) を使い、コマンドのフラグとフォーマットは [tmux マニュアル](/tmux/latest/manual/)を参照してください。
