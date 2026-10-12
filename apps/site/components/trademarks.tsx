import styles from "./trademarks.module.css";

/** The trademark notice from the README, for every page that names evertap or an engine. */
export function Trademarks() {
  return (
    <div className={styles.notice}>
      <p>
        The evertap name and logo are not licensed with the code (section 6 of the license). You may
        use them to refer to evertap, but not to name or brand your own product or service, or in a
        way that suggests evertap made or endorses it, without permission.
      </p>
      <p>
        evertap is an independent project. It is not affiliated with, endorsed, sponsored,
        supported, or certified by the owners of the software it runs, and it uses their names only
        to say which software that is.
      </p>
      <ul>
        <li>
          Postgres, PostgreSQL and the Slonik Logo are trademarks or registered trademarks of the
          PostgreSQL Community Association of Canada, and used with their permission.
        </li>
        <li>MySQL is a registered trademark of Oracle and/or its affiliates.</li>
        <li>
          Redis is a registered trademark of Redis Ltd. Any rights therein are reserved to Redis
          Ltd.
        </li>
        <li>
          Other names, including Garage and Cloudflare, may be trademarks of their respective
          owners.
        </li>
      </ul>
    </div>
  );
}
