import Link from "next/link";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "../chatgpt-auth";
import MultiplayerClient from "./MultiplayerClient";
import styles from "./multiplayer.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "多人牌桌 · RangeCraft",
  description: "创建私密德州牌局，邀请朋友入座并在线对战。",
};

export default async function MultiplayerPage() {
  const user = await getChatGPTUser();

  if (!user) {
    return (
      <main className={styles.authPage}>
        <div className={styles.ambientOne} />
        <div className={styles.ambientTwo} />
        <nav className={styles.authNav}>
          <Link className={styles.brand} href="/">
            <span className={styles.brandMark}>R</span>
            <span>RANGECRAFT</span>
          </Link>
          <Link className={styles.quietLink} href="/">
            返回主页
          </Link>
        </nav>

        <section className={styles.authCard}>
          <p className={styles.eyebrow}>PRIVATE TABLES · 2–10 PLAYERS</p>
          <h1>先确认身份，再坐上牌桌</h1>
          <p className={styles.authLead}>
            多人牌局需要登录来保存昵称、筹码和房间身份。RangeCraft 不保存密码，也不会把你的邮箱展示给其他玩家。
          </p>
          <a
            className={styles.primaryAction}
            href={chatGPTSignInPath("/multiplayer")}
          >
            使用 ChatGPT 登录
            <span aria-hidden="true">→</span>
          </a>
          <div className={styles.authNotes}>
            <span>首次登录设置牌桌昵称</span>
            <span>邀请码私密入桌</span>
            <span>服务器隐藏对手底牌</span>
          </div>
        </section>
      </main>
    );
  }

  return (
    <MultiplayerClient
      displayName={user.fullName ?? "牌手"}
      signOutHref={chatGPTSignOutPath("/")}
    />
  );
}
