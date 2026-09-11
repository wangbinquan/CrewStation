/** 副本间转发标记头；带此头的命令只在本副本处理，防止环转。 */
export const FORWARDED_HEADER = 'x-cs-forwarded';
