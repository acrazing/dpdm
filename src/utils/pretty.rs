use colored::Colorize;

pub fn pretty_circular(circulars: &[Vec<String>], prefix: &str) -> String {
    let digits = (circulars.len() as f64).log10().ceil() as usize;
    circulars
        .iter()
        .enumerate()
        .map(|(index, line)| {
            format!(
                "{}{}{}{}",
                prefix,
                format!("{:0>width$}", index + 1, width = digits).color("gray"),
                ") ".color("gray"),
                line.iter()
                    .map(|item| item.red().to_string())
                    .collect::<Vec<_>>()
                    .join(&" -> ".color("gray").to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}
