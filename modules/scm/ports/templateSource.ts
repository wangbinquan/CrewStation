/** 把业务项目模板的内容复制到目标目录；模板名不存在时抛 not_found。 */
export interface TemplateSource {
  materialize(templateName: string, targetDir: string): Promise<void>;
}
