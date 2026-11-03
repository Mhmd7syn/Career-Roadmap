window.RoadmapRegistry = window.RoadmapRegistry || {};

window.RoadmapRegistry['data'] = {
  id: 'data',
  title: 'Track 2: Data Ecosystem',
  parentRoadmapId: 'tech',
  description: 'Analytics, advanced SQL, data modeling, automated ETL/ELT pipelines, and distributed data.',
  stations: [
    {
      id: 'data-analytics',
      title: 'Advanced SQL & Data Analytics',
      badge: 'DATA-01',
      description: 'Window functions, CTEs, Polars/Pandas data wrangling, and KPI metrics design.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Window functions (ROW_NUMBER, LAG/LEAD), recursive CTEs, vector operations.' },
        { level: 2, title: 'Applied', goal: 'Cohort retention analysis, conversion funnels, EDA with Polars.' },
        { level: 3, title: 'Deep Dive', goal: 'Query optimization on large analytical datasets, columnar memory layouts.' }
      ],
      resources: [
        { label: 'Mode Analytics Advanced SQL Tutorial', url: 'https://mode.com/sql-tutorial/' }
      ],
      concept: 'High-leverage analytical SQL turns raw relational transactions into executive business intelligence and product metrics.',
      activeRecall: 'What is the operational difference between `RANK()`, `DENSE_RANK()`, and `ROW_NUMBER()`?'
    },
    {
      id: 'data-warehousing',
      title: 'Data Warehousing & dbt Transformations',
      badge: 'DATA-02',
      description: 'Dimensional modeling (Kimball Star/Snowflake), dbt (data build tool), and Snowflake/BigQuery.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Fact vs Dimension tables, OLTP vs OLAP architecture, dbt DAG concept.' },
        { level: 2, title: 'Applied', goal: 'Build modular dbt models, write schema tests, generate dbt documentation.' },
        { level: 3, title: 'Deep Dive', goal: 'Incremental models, partition pruning, clustering keys, Lakehouse formats (Iceberg).' }
      ],
      resources: [
        { label: 'dbt Fundamentals (Official Free Course)', url: 'https://courses.getdbt.com/' }
      ],
      concept: 'Modern data warehousing separates storage from compute, using dbt to apply software engineering practices to SQL.',
      activeRecall: 'What is a Slowly Changing Dimension (SCD Type 2), and how does dbt handle snapshotting?'
    },
    {
      id: 'data-pipelines',
      title: 'Pipeline Orchestration & ETL/ELT',
      badge: 'DATA-03',
      description: 'Apache Airflow, Prefect, DAG scheduling, idempotent task design, and data contracts.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'ETL vs ELT trade-offs, DAG execution mechanics, retry and backfill logic.' },
        { level: 2, title: 'Applied', goal: 'Build an Airflow DAG that extracts an API, transforms data, and loads to warehouse.' },
        { level: 3, title: 'Deep Dive', goal: 'Dynamic task mapping, Airflow Celery/Kube executors, Great Expectations data contracts.' }
      ],
      resources: [
        { label: 'Apache Airflow Core Concepts Guide', url: 'https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/' }
      ],
      concept: 'Data pipelines must be idempotent: running the same pipeline twice on the same day must produce the same result without duplicate data.',
      activeRecall: 'Why is idempotency critical in batch ETL pipelines, and how do backfills handle historical reprocessing?'
    },
    {
      id: 'data-bigdata',
      title: 'Distributed Compute & Event Streaming',
      badge: 'DATA-04',
      description: 'Apache Spark / PySpark, cluster partitions, and Apache Kafka / Redpanda event streaming.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Spark driver/worker architecture, RDDs/DataFrames, Kafka topics and consumer groups.' },
        { level: 2, title: 'Applied', goal: 'Process multi-gigabyte datasets with PySpark; produce and consume Kafka event messages.' },
        { level: 3, title: 'Deep Dive', goal: 'Spark shuffle partition tuning, skew mitigation, exactly-once stream processing.' }
      ],
      resources: [
        { label: 'Spark: The Definitive Guide (Architecture Overview)', url: 'https://spark.apache.org/docs/latest/' }
      ],
      concept: 'When data exceeds single-machine RAM, distributed compute and event streams provide horizontal data scalability.',
      activeRecall: 'How do Kafka partitions determine concurrency and ordering guarantees for consumers in a group?'
    }
  ]
};
