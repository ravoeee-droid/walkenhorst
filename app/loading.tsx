import styles from "./loading.module.css";

export default function Loading() {
  return (
    <div className={styles.screen} role="status" aria-live="polite">
      <div className={styles.progress}><span /></div>
      <div className={styles.shell}>
        <div className={styles.mark}>W</div>
        <div className={styles.copy}>
          <span>Walkenhorst Energy Sales OS</span>
          <strong>Ansicht wird vorbereitet</strong>
          <small>Daten, Automationen und CRM werden synchronisiert …</small>
        </div>
        <div className={styles.cards}>
          <div /><div /><div /><div />
        </div>
        <div className={styles.rows}>
          <i /><i /><i /><i /><i />
        </div>
      </div>
    </div>
  );
}
